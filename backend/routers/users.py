from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import create_token, get_current_user, hash_passcode, verify_passcode
from database import get_db, seed_user_categories
from models import User

router = APIRouter()

_AVATAR_COLORS = ["#5a7a8a", "#c0522a", "#4a7c59", "#7a5a82", "#b07030", "#2a8a82", "#9a4848", "#b88820"]


def _user_out(u: User, include_token: Optional[str] = None) -> dict:
    d = {
        "id": u.id,
        "name": u.name,
        "avatar_color": u.avatar_color,
        "has_passcode": u.passcode_hash is not None,
    }
    if include_token:
        d["token"] = include_token
    return d


# ── Public: list users (for profile picker — no auth needed) ──────────────────

@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.id).all()
    return [_user_out(u) for u in users]


# ── Public: login ──────────────────────────────────────────────────────────────

@router.post("/auth/login")
def login(payload: dict, db: Session = Depends(get_db)):
    user_id = payload.get("user_id")
    passcode = payload.get("passcode") or ""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.passcode_hash is not None:
        if not verify_passcode(passcode, user.passcode_hash):
            raise HTTPException(status_code=401, detail="Incorrect passcode")
    token = create_token(user.id)
    return _user_out(user, include_token=token)


# ── Public: create user ────────────────────────────────────────────────────────

@router.post("/users")
def create_user(payload: dict, db: Session = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    passcode = payload.get("passcode") or ""
    color_idx = db.query(User).count() % len(_AVATAR_COLORS)
    avatar_color = payload.get("avatar_color") or _AVATAR_COLORS[color_idx]
    user = User(
        name=name,
        passcode_hash=hash_passcode(passcode) if passcode else None,
        avatar_color=avatar_color,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    seed_user_categories(db, user.id)
    token = create_token(user.id)
    return _user_out(user, include_token=token)


# ── Authenticated: update own profile ─────────────────────────────────────────

@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's profile")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if "name" in payload and payload["name"]:
        user.name = payload["name"].strip()
    if "avatar_color" in payload and payload["avatar_color"]:
        user.avatar_color = payload["avatar_color"]
    if "passcode" in payload:
        # Empty string = remove passcode; non-empty = set new passcode
        new_pc = payload["passcode"] or ""
        user.passcode_hash = hash_passcode(new_pc) if new_pc else None
    db.commit()
    db.refresh(user)
    return _user_out(user)


# ── Authenticated: delete own profile ─────────────────────────────────────────

@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(User).count() <= 1:
        raise HTTPException(status_code=409, detail="Cannot delete the only user")
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's profile")
    from models import Transaction
    tx_count = db.query(Transaction).filter(Transaction.user_id == user_id).count()
    if tx_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: user has {tx_count} transaction(s). Delete all data first.",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"deleted": True}
