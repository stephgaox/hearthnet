from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    passcode_hash = Column(String(200), nullable=True)   # None = no passcode required
    avatar_color = Column(String(7), nullable=False, default="#5a7a8a")
    created_at = Column(DateTime, server_default=func.now())


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    type = Column(String(50), nullable=False)   # 'credit_card' | 'bank_account'
    institution = Column(String(100), nullable=True)
    last4 = Column(String(4), nullable=True)
    color = Column(String(7), nullable=False, default="#8a9aaa")
    created_at = Column(DateTime, server_default=func.now())


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)           # unique per (name, user_id) — enforced in DB migration
    color = Column(String(7), nullable=False, default="#a89268")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    date = Column(Date, nullable=False, index=True)
    description = Column(String(500), nullable=False)
    amount = Column(Numeric(12, 2, asdecimal=False), nullable=False)
    type = Column(String(20), nullable=False)   # 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'transfer' (legacy)
    category = Column(String(100), nullable=False, default="Other")
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    account = Column(String(200), nullable=True)   # legacy free-text, kept for old rows
    source_file = Column(String(500), nullable=True)
    file_hash = Column(String(64), nullable=True, index=True)  # SHA-256 of uploaded file
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
