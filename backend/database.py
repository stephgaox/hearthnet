from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./familybudget.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

# Enable FK enforcement for SQLite
if "sqlite" in DATABASE_URL:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_column_if_missing(conn, stmt: str):
    try:
        conn.execute(text(stmt))
        conn.commit()
    except OperationalError:
        pass  # column already exists


def _column_exists(conn, table: str, column: str) -> bool:
    try:
        conn.execute(text(f"SELECT {column} FROM {table} LIMIT 1"))
        return True
    except Exception:
        return False


# ── Default category list ─────────────────────────────────────────────────────

DEFAULT_CATEGORIES = [
    ("Food & Dining",    "#c0522a", 0),
    ("Groceries",        "#4a7c59", 1),
    ("Kids & Childcare", "#c07838", 2),
    ("Car",              "#5a7a8a", 3),
    ("Entertainment",    "#7a5a82", 4),
    ("Shopping",         "#b07030", 5),
    ("Home",             "#7a5c3a", 6),
    ("Subscriptions",    "#2a8a82", 7),
    ("Medical",          "#9a4848", 8),
    ("Education",        "#6b7a3e", 9),
    ("Travel",           "#9a7248", 10),
    ("Pet",              "#b88820", 11),
    ("Bills & Utilities","#6a7888", 12),
    ("Income",           "#357a52", 13),
    ("Refund",           "#5a7a4a", 14),
    ("Other",            "#a89268", 15),
    ("Transfer",         "#8a9aaa", 16),
    ("Withdraw",         "#8a5a3a", 17),
    ("CC Payments",      "#5a7a9a", 18),
    ("Payment Received", "#6a8872", 19),
]


def seed_user_categories(db, user_id: int):
    """Seed the default category set for a given user (idempotent)."""
    from models import Category as CatModel
    for name, color, order in DEFAULT_CATEGORIES:
        if not db.query(CatModel).filter(
            CatModel.name == name, CatModel.user_id == user_id
        ).first():
            db.add(CatModel(name=name, color=color, sort_order=order, user_id=user_id))
    db.commit()


def create_tables():
    from models import Account, Transaction, Category, User  # noqa: F401
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        # ── Legacy column migrations (pre-user era) ───────────────────────────
        _add_column_if_missing(conn, "ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)")
        _add_column_if_missing(conn, "ALTER TABLE transactions ADD COLUMN file_hash TEXT")

        # Remove exact duplicates
        conn.execute(text("""
            DELETE FROM transactions
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM transactions
                GROUP BY date, description, amount, account_id
            )
        """))

        # Rename "Transportation" → "Car"
        conn.execute(text("UPDATE transactions SET category = 'Car' WHERE category = 'Transportation'"))
        conn.execute(text("UPDATE categories SET name = 'Car' WHERE name = 'Transportation'"))

        # Re-tone category colors
        for name, color in [
            ("Food & Dining",    "#c0522a"),
            ("Groceries",        "#4a7c59"),
            ("Kids & Childcare", "#c07838"),
            ("Car",              "#5a7a8a"),
            ("Entertainment",    "#7a5a82"),
            ("Shopping",         "#b07030"),
            ("Home",             "#7a5c3a"),
            ("Subscriptions",    "#2a8a82"),
            ("Medical",          "#9a4848"),
            ("Education",        "#6b7a3e"),
            ("Travel",           "#9a7248"),
            ("Pet",              "#b88820"),
            ("Bills & Utilities","#6a7888"),
            ("Income",           "#357a52"),
            ("Refund",           "#5a7a4a"),
            ("Other",            "#a89268"),
            ("Transfer",         "#8a9aaa"),
            ("Withdraw",         "#8a5a3a"),
            ("CC Payments",      "#5a7a9a"),
            ("Payment Received", "#6a8872"),
        ]:
            conn.execute(text(
                "UPDATE categories SET color = :color WHERE name = :name"
            ), {"color": color, "name": name})

        # Ensure amounts are positive
        conn.execute(text("UPDATE transactions SET amount = ABS(amount) WHERE amount < 0"))

        # Re-tone legacy vivid defaults
        conn.execute(text("UPDATE accounts SET color = '#8a9aaa' WHERE color = '#3b82f6'"))
        conn.execute(text("UPDATE categories SET color = '#a89268' WHERE color = '#6b7280'"))

        conn.commit()

        # ── Multi-user migration ───────────────────────────────────────────────

        # 1. Ensure the users table has a Default user (id=1)
        default_user_exists = conn.execute(
            text("SELECT id FROM users LIMIT 1")
        ).fetchone()
        if not default_user_exists:
            conn.execute(text(
                "INSERT INTO users (id, name, avatar_color) VALUES (1, 'Default', '#5a7a8a')"
            ))
            conn.commit()

        # 2. Add user_id to accounts (simple ALTER — no unique constraint issue)
        if not _column_exists(conn, "accounts", "user_id"):
            conn.execute(text("ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) DEFAULT 1"))
            conn.execute(text("UPDATE accounts SET user_id = 1 WHERE user_id IS NULL"))
            conn.commit()

        # 3. Add user_id to transactions
        if not _column_exists(conn, "transactions", "user_id"):
            conn.execute(text("ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id) DEFAULT 1"))
            conn.execute(text("UPDATE transactions SET user_id = 1 WHERE user_id IS NULL"))
            conn.commit()

        # 4. Recreate categories table to add user_id + composite unique(name, user_id).
        #    The old table had a single-column UNIQUE on name, which would block multiple
        #    users from having the same category names.
        if not _column_exists(conn, "categories", "user_id"):
            conn.execute(text("""
                CREATE TABLE categories_new (
                    id       INTEGER PRIMARY KEY,
                    user_id  INTEGER REFERENCES users(id),
                    name     VARCHAR(100) NOT NULL,
                    color    VARCHAR(7)   NOT NULL DEFAULT '#a89268',
                    sort_order INTEGER    DEFAULT 0,
                    created_at DATETIME   DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(name, user_id)
                )
            """))
            conn.execute(text("""
                INSERT INTO categories_new (id, user_id, name, color, sort_order, created_at)
                SELECT id, 1, name, color, sort_order, created_at FROM categories
            """))
            conn.execute(text("DROP TABLE categories"))
            conn.execute(text("ALTER TABLE categories_new RENAME TO categories"))
            conn.commit()

    # ── Seed categories for Default user if missing ───────────────────────────
    seed_db = SessionLocal()
    try:
        seed_user_categories(seed_db, user_id=1)
    finally:
        seed_db.close()
