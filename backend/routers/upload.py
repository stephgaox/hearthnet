import hashlib
import os
import tempfile
import traceback
from datetime import date as date_type

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Account, Transaction, User
from services.ai_parser import AIUnavailableError, parse_file as parse_file_ai
from services.direct_parser import parse_file_direct
from services.pdf_parser import parse_pdf_direct
from services.account_detector import build_account_hint

router = APIRouter()


def _apply_merchant_learning(transactions: list[dict], db: Session, user_id: int) -> list[dict]:
    """Override parser-assigned category with the user's most-recent correction
    for the same merchant, scoped to the current user's transaction history."""
    for tx in transactions:
        desc_norm = " ".join(tx.get("description", "").lower().split())
        if not desc_norm:
            continue

        match = (
            db.query(Transaction.category)
            .filter(
                func.lower(Transaction.description) == desc_norm,
                Transaction.user_id == user_id,
            )
            .order_by(Transaction.created_at.desc())
            .first()
        )
        if match:
            tx["category"] = match[0]
            continue

        prefix = desc_norm[:20]
        if len(prefix) >= 8:
            match = (
                db.query(Transaction.category)
                .filter(
                    func.lower(Transaction.description).startswith(prefix),
                    Transaction.user_id == user_id,
                )
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
async def parse_statement(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filename = file.filename or ""
    suffix = os.path.splitext(filename)[1] or ".tmp"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    file_hash = hashlib.sha256(content).hexdigest()

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

    transactions = _apply_merchant_learning(transactions, db, current_user.id)
    account_hint = build_account_hint(filename, file_text)

    return {
        "transactions": transactions,
        "count": len(transactions),
        "method": method,
        "account_hint": account_hint,
        "file_hash": file_hash,
    }


def _get_or_create_account(db: Session, account_data: dict, user_id: int) -> Account:
    """Find existing account by last4+institution (for this user) or create a new one."""
    last4 = account_data.get("last4")
    institution = account_data.get("institution")
    name = account_data.get("name", "").strip()

    if last4 and institution:
        existing = (
            db.query(Account)
            .filter(
                Account.last4 == last4,
                Account.institution == institution,
                Account.user_id == user_id,
            )
            .first()
        )
        if existing:
            if name and existing.name != name:
                existing.name = name
            if account_data.get("color"):
                existing.color = account_data["color"]
            db.commit()
            db.refresh(existing)
            return existing

    acct = Account(
        name=name or f"{institution or 'Account'} ...{last4 or ''}".strip(),
        type=account_data.get("type", "credit_card"),
        institution=institution,
        last4=last4,
        color=account_data.get("color", "#3b82f6"),
        user_id=user_id,
    )
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


@router.post("/upload/confirm")
async def confirm_upload(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    transactions = payload.get("transactions", [])
    source_file = payload.get("source_file", "")
    file_hash = payload.get("file_hash")
    account_data = payload.get("account")

    # Duplicate file check scoped to this user
    if file_hash:
        existing = db.query(Transaction).filter(
            Transaction.file_hash == file_hash,
            Transaction.user_id == current_user.id,
        ).first()
        if existing:
            return {"saved": 0, "duplicate": True}

    account_id = None
    account_name = None
    direct_account_id = payload.get("account_id")
    if direct_account_id:
        acct = db.query(Account).filter(
            Account.id == direct_account_id,
            Account.user_id == current_user.id,
        ).first()
        if acct:
            account_id = acct.id
            account_name = acct.name
    elif account_data:
        acct = _get_or_create_account(db, account_data, current_user.id)
        account_id = acct.id
        account_name = acct.name

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
        tx_type = _CATEGORY_TYPE_MAP.get(category) or t.get("type", "expense")

        already_exists = db.query(Transaction).filter(
            Transaction.date == tx_date,
            Transaction.description == description,
            Transaction.amount == amount,
            Transaction.account_id == account_id,
            Transaction.user_id == current_user.id,
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
            user_id=current_user.id,
        )
        db.add(tx)
        saved += 1

    db.commit()
    return {"saved": saved, "skipped": skipped, "duplicate": False}


@router.get("/accounts")
def list_accounts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    accounts = db.query(Account).filter(
        Account.user_id == current_user.id
    ).order_by(Account.name).all()
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
