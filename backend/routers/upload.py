import hashlib
import os
import tempfile
import traceback
from datetime import date as date_type

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Account, Transaction
from services.ai_parser import AIUnavailableError, parse_file as parse_file_ai, is_ai_available
from services.direct_parser import parse_file_direct
from services.pdf_parser import parse_pdf_direct
from services.account_detector import build_account_hint

router = APIRouter()


def _apply_merchant_learning(transactions: list[dict], db: Session) -> list[dict]:
    """Override parser-assigned category with the user's most-recent correction
    for the same merchant, based on description matching.

    Only category is learned — type is always determined by the parser since
    users only recategorize transactions, they don't change the type.
    """
    for tx in transactions:
        desc_norm = " ".join(tx.get("description", "").lower().split())
        if not desc_norm:
            continue

        # Pass 1: exact description match (case-insensitive), most recent first
        match = (
            db.query(Transaction.category)
            .filter(func.lower(Transaction.description) == desc_norm)
            .order_by(Transaction.created_at.desc())
            .first()
        )
        if match:
            tx["category"] = match[0]
            continue

        # Pass 2: prefix match — first 20 chars handles slight variations
        # (e.g. "WHOLE FOODS #123" vs "WHOLE FOODS #456")
        prefix = desc_norm[:20]
        if len(prefix) >= 8:
            match = (
                db.query(Transaction.category)
                .filter(func.lower(Transaction.description).startswith(prefix))
                .order_by(Transaction.created_at.desc())
                .first()
            )
            if match:
                tx["category"] = match[0]

    return transactions

DIRECT_EXTENSIONS = {".csv", ".xlsx", ".xls"}


def _use_direct(filename: str) -> bool:
    return os.path.splitext(filename or "")[1].lower() in DIRECT_EXTENSIONS


@router.post("/upload/parse")
async def parse_statement(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Parse a file, return transactions + account hint + file hash for user to confirm."""
    filename = file.filename or ""
    suffix = os.path.splitext(filename)[1] or ".tmp"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    # Compute file hash for duplicate detection
    file_hash = hashlib.sha256(content).hexdigest()

    # Read text for account detection (CSV/txt only)
    file_text = None
    if suffix.lower() in (".csv", ".txt"):
        try:
            file_text = content.decode("utf-8-sig", errors="replace")
        except Exception:
            pass

    try:
        if _use_direct(filename):
            transactions = parse_file_direct(tmp_path)
            method = "direct"
        elif suffix.lower() == ".pdf":
            result = parse_pdf_direct(tmp_path)
            if result is not None:
                transactions = result
                method = "pdf"
            else:
                # Scanned/image PDF — fall back to AI
                transactions = parse_file_ai(tmp_path, file.content_type or "application/pdf")
                method = "ai"
        else:
            transactions = parse_file_ai(tmp_path, file.content_type or "text/plain")
            method = "ai"
    except AIUnavailableError:
        raise HTTPException(
            status_code=422,
            detail=(
                "This file requires AI parsing (scanned PDF or image), "
                "but no Anthropic API key is configured. "
                "Please upload a CSV, Excel (.xlsx), or digital PDF instead — "
                "or add ANTHROPIC_API_KEY to your .env file to enable AI parsing."
            ),
        )
    except Exception as e:
        print(f"[upload error] {type(e).__name__}: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")
    finally:
        os.unlink(tmp_path)

    transactions = _apply_merchant_learning(transactions, db)
    account_hint = build_account_hint(filename, file_text)

    return {
        "transactions": transactions,
        "count": len(transactions),
        "method": method,
        "account_hint": account_hint,
        "file_hash": file_hash,
    }


def _get_or_create_account(db: Session, account_data: dict) -> Account:
    """Find existing account by last4+institution or create a new one."""
    last4 = account_data.get("last4")
    institution = account_data.get("institution")
    name = account_data.get("name", "").strip()

    # Try to find by last4 + institution (same card/account)
    if last4 and institution:
        existing = (
            db.query(Account)
            .filter(Account.last4 == last4, Account.institution == institution)
            .first()
        )
        if existing:
            # Update name/color if user changed it
            if name and existing.name != name:
                existing.name = name
            if account_data.get("color"):
                existing.color = account_data["color"]
            db.commit()
            db.refresh(existing)
            return existing

    # Create new
    acct = Account(
        name=name or f"{institution or 'Account'} ...{last4 or ''}".strip(),
        type=account_data.get("type", "credit_card"),
        institution=institution,
        last4=last4,
        color=account_data.get("color", "#3b82f6"),
    )
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


@router.post("/upload/confirm")
async def confirm_upload(payload: dict, db: Session = Depends(get_db)):
    """Save confirmed transactions + account to the database."""
    transactions = payload.get("transactions", [])
    source_file = payload.get("source_file", "")
    file_hash = payload.get("file_hash")
    account_data = payload.get("account")  # may be None for old callers

    # Duplicate file check — if this exact file was already uploaded, refuse
    if file_hash:
        existing = db.query(Transaction).filter(Transaction.file_hash == file_hash).first()
        if existing:
            return {"saved": 0, "duplicate": True}

    account_id = None
    account_name = None
    direct_account_id = payload.get("account_id")
    if direct_account_id:
        acct = db.query(Account).filter(Account.id == direct_account_id).first()
        if acct:
            account_id = acct.id
            account_name = acct.name
    elif account_data:
        acct = _get_or_create_account(db, account_data)
        account_id = acct.id
        account_name = acct.name

    # Category → type mapping: ensures directional types are correct even if the
    # UI payload loses the sign from the parser (e.g. after merchant-learning override).
    _CATEGORY_TYPE_MAP = {
        "CC Payments":      "transfer_out",
        "Payment Received": "transfer_in",
        "Withdraw":         "transfer_out",
    }

    saved = 0
    skipped = 0
    for t in transactions:
        try:
            tx_date = date_type.fromisoformat(t["date"])
        except (ValueError, KeyError):
            continue

        amount = abs(float(t.get("amount", 0)))
        description = t.get("description", "")
        category = t.get("category", "Other")
        # If the category unambiguously implies a direction, use it;
        # otherwise trust whatever type the parser or merchant-learning assigned.
        tx_type = _CATEGORY_TYPE_MAP.get(category) or t.get("type", "expense")

        # Per-transaction duplicate check: same date + description + amount + account
        already_exists = db.query(Transaction).filter(
            Transaction.date == tx_date,
            Transaction.description == description,
            Transaction.amount == amount,
            Transaction.account_id == account_id,
        ).first()
        if already_exists:
            skipped += 1
            continue

        tx = Transaction(
            date=tx_date,
            description=description,
            amount=amount,
            type=tx_type,
            category=category,
            account_id=account_id,
            account=account_name or t.get("account"),
            source_file=source_file,
            file_hash=file_hash,
            notes=t.get("notes"),
        )
        db.add(tx)
        saved += 1

    db.commit()
    return {"saved": saved, "skipped": skipped, "duplicate": False}


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)):
    accounts = db.query(Account).order_by(Account.name).all()
    return [
        {
            "id": a.id,
            "name": a.name,
            "type": a.type,
            "institution": a.institution,
            "last4": a.last4,
            "color": a.color,
        }
        for a in accounts
    ]
