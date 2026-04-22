from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Account, Category, Transaction, User

router = APIRouter()

# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories")
def list_categories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cats = (
        db.query(Category)
        .filter(Category.user_id == current_user.id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )
    return [{"id": c.id, "name": c.name, "color": c.color} for c in cats]


@router.post("/categories")
def create_category(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if db.query(Category).filter(Category.name == name, Category.user_id == current_user.id).first():
        raise HTTPException(status_code=409, detail="Category already exists")
    max_order = db.query(Category).filter(Category.user_id == current_user.id).count()
    cat = Category(
        name=name,
        color=payload.get("color", "#6b7280"),
        sort_order=max_order,
        user_id=current_user.id,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return {"id": cat.id, "name": cat.name, "color": cat.color}


@router.patch("/categories/{cat_id}")
def update_category(
    cat_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter(Category.id == cat_id, Category.user_id == current_user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if "name" in payload and payload["name"]:
        new_name = payload["name"].strip()
        if new_name != cat.name:
            existing = db.query(Category).filter(
                func.lower(Category.name) == new_name.lower(),
                Category.id != cat_id,
                Category.user_id == current_user.id,
            ).first()
            if existing:
                # Merge: move this user's transactions to the existing category
                db.query(Transaction).filter(
                    Transaction.category == cat.name, Transaction.user_id == current_user.id
                ).update({"category": existing.name}, synchronize_session=False)
                db.delete(cat)
                db.commit()
                return {"id": existing.id, "name": existing.name, "color": existing.color, "merged": True}
            # Normal rename — cascade to this user's transactions
            db.query(Transaction).filter(
                Transaction.category == cat.name, Transaction.user_id == current_user.id
            ).update({"category": new_name}, synchronize_session=False)
        cat.name = new_name
    if "color" in payload and payload["color"]:
        cat.color = payload["color"]
    db.commit()
    db.refresh(cat)
    return {"id": cat.id, "name": cat.name, "color": cat.color}


@router.delete("/categories/{cat_id}")
def delete_category(
    cat_id: int,
    reassign_to: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter(Category.id == cat_id, Category.user_id == current_user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    count = db.query(Transaction).filter(
        Transaction.category == cat.name, Transaction.user_id == current_user.id
    ).count()
    if count > 0:
        if not reassign_to:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete: {count} transaction(s) use this category",
            )
        db.query(Transaction).filter(
            Transaction.category == cat.name, Transaction.user_id == current_user.id
        ).update({"category": reassign_to}, synchronize_session=False)
    db.delete(cat)
    db.commit()
    return {"deleted": True}


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get("/accounts/date-ranges")
def account_date_ranges(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(
            Transaction.account_id,
            func.min(Transaction.date).label("min_date"),
            func.max(Transaction.date).label("max_date"),
        )
        .filter(Transaction.account_id.isnot(None), Transaction.user_id == current_user.id)
        .group_by(Transaction.account_id)
        .all()
    )
    return [
        {"account_id": r.account_id, "min_date": str(r.min_date), "max_date": str(r.max_date)}
        for r in rows
    ]


@router.post("/accounts")
def create_account(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    acct = Account(
        name=name,
        type=payload.get("type", "credit_card"),
        institution=payload.get("institution"),
        last4=payload.get("last4"),
        color=payload.get("color", "#3b82f6"),
        user_id=current_user.id,
    )
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return {"id": acct.id, "name": acct.name, "type": acct.type,
            "institution": acct.institution, "last4": acct.last4, "color": acct.color}


@router.patch("/accounts/{acct_id}")
def update_account(
    acct_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    acct = db.query(Account).filter(Account.id == acct_id, Account.user_id == current_user.id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    if "name" in payload and payload["name"] is not None:
        new_name = payload["name"].strip()
        if new_name != acct.name:
            db.query(Transaction).filter(
                Transaction.account_id == acct_id, Transaction.user_id == current_user.id
            ).update({"account": new_name}, synchronize_session=False)
        acct.name = new_name
    for field in ("type", "institution", "last4", "color"):
        if field in payload and payload[field] is not None:
            setattr(acct, field, payload[field])
    db.commit()
    db.refresh(acct)
    return {"id": acct.id, "name": acct.name, "type": acct.type,
            "institution": acct.institution, "last4": acct.last4, "color": acct.color}


@router.delete("/accounts/{acct_id}")
def delete_account(
    acct_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    acct = db.query(Account).filter(Account.id == acct_id, Account.user_id == current_user.id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    count = db.query(Transaction).filter(
        Transaction.account_id == acct_id, Transaction.user_id == current_user.id
    ).count()
    if count > 0:
        raise HTTPException(status_code=409, detail=f"Cannot delete: {count} transaction(s) linked to this account")
    db.delete(acct)
    db.commit()
    return {"deleted": True}
