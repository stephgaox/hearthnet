from datetime import date as date_type

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Account, Transaction, User

router = APIRouter()

_CC_PAYMENT_KW = [
    "epay", "autopay", "credit card pay", "card srvc",
    "card svc", "crd pay", "statement pay",
]

_TRANSFER_TYPES = {"transfer", "transfer_in", "transfer_out"}


def _month_range(year: int, month: int):
    start = date_type(year, month, 1)
    end = date_type(year + 1, 1, 1) if month == 12 else date_type(year, month + 1, 1)
    return start, end


def _sort_cats(d: dict) -> list:
    return sorted(
        [{"name": k, "amount": round(v, 2)} for k, v in d.items()],
        key=lambda x: -x["amount"],
    )


def _aggregate_monthly(txs, accounts_map):
    bank_income = bank_direct_exp = bank_cc_payments = 0.0
    cc_spending = cc_refunds = 0.0
    has_typed = False
    has_cc_payment_pattern = False
    categories_bank: dict[str, float] = {}
    categories_cc: dict[str, float] = {}

    for t in txs:
        desc_low = t.description.lower()
        if t.category == "CC Payments" or any(k in desc_low for k in _CC_PAYMENT_KW):
            has_cc_payment_pattern = True
        if t.type in _TRANSFER_TYPES and t.category != "CC Payments":
            continue
        if not t.account_id:
            continue
        acct = accounts_map.get(t.account_id)
        if acct is None:
            continue
        has_typed = True

        if acct.type == "bank_account":
            if t.type == "income":
                bank_income += t.amount
            elif t.category == "CC Payments":
                bank_cc_payments += t.amount
            elif t.type == "expense":
                bank_direct_exp += t.amount
                if t.category not in ("Refund", "CC Payments", "Payment Received"):
                    categories_bank[t.category] = categories_bank.get(t.category, 0) + t.amount
        elif acct.type == "credit_card":
            if t.type == "expense":
                cc_spending += t.amount
                if t.category not in ("CC Payments", "Payment Received"):
                    categories_cc[t.category] = categories_cc.get(t.category, 0) + t.amount
            elif t.type == "income":
                cc_refunds += t.amount

    return {
        "bank_income": bank_income,
        "bank_direct_exp": bank_direct_exp,
        "bank_cc_payments": bank_cc_payments,
        "cc_spending": cc_spending,
        "cc_refunds": cc_refunds,
        "has_typed": has_typed,
        "has_cc_payment_pattern": has_cc_payment_pattern,
        "categories_bank": categories_bank,
        "categories_cc": categories_cc,
    }


@router.get("/dashboard/monthly")
def monthly_dashboard(
    year: int = Query(...),
    month: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _month_range(year, month)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}

    r = _aggregate_monthly(txs, accounts_map)
    bank_income     = r["bank_income"]
    total_expense   = r["bank_direct_exp"] + r["bank_cc_payments"]
    cc_net_charges  = r["cc_spending"] - r["cc_refunds"]
    categories_bank = r["categories_bank"]
    categories_cc   = r["categories_cc"]

    categories_all: dict[str, float] = {}
    for k, v in categories_bank.items():
        categories_all[k] = categories_all.get(k, 0) + v
    for k, v in categories_cc.items():
        categories_all[k] = categories_all.get(k, 0) + v

    missing_cc_warning = (
        r["has_typed"] and r["has_cc_payment_pattern"]
        and r["cc_spending"] == 0 and r["cc_refunds"] == 0
    )

    return {
        "summary": {
            "income":       round(bank_income, 2),
            "expenses":     round(total_expense, 2),
            "net":          round(bank_income - total_expense, 2),
            "savings_rate": round((bank_income - total_expense) / bank_income * 100, 1)
                            if bank_income >= 1 else 0,
        },
        "categories":      _sort_cats(categories_all),
        "categories_bank": _sort_cats(categories_bank),
        "categories_cc":   _sort_cats(categories_cc),
        "cc_payments_total": round(r["bank_cc_payments"], 2),
        "cc_net_charges":    round(cc_net_charges, 2),
        "by_account_type": {
            "bank_income":   round(bank_income, 2),
            "bank_spending": round(total_expense, 2),
            "cc_spending":   round(r["cc_spending"], 2),
            "cc_refunds":    round(r["cc_refunds"], 2),
            "net_cc":        round(cc_net_charges, 2),
        } if r["has_typed"] else None,
        "missing_cc_warning": missing_cc_warning,
    }


def _account_breakdown(txs, accounts_map):
    totals: dict = {}
    for t in txs:
        if t.account_id and t.account_id in accounts_map:
            acct = accounts_map[t.account_id]
            key = f"id:{t.account_id}"
            if key not in totals:
                totals[key] = {"name": acct.name, "color": acct.color, "last4": acct.last4, "amount": 0.0}
            totals[key]["amount"] += t.amount
        else:
            label = t.account or "Unassigned"
            key = f"txt:{label}"
            if key not in totals:
                totals[key] = {"name": label, "color": "#a89268", "last4": None, "amount": 0.0}
            totals[key]["amount"] += t.amount
    result = sorted(totals.values(), key=lambda x: -x["amount"])
    for r in result:
        r["amount"] = round(r["amount"], 2)
    return result


@router.get("/dashboard/monthly/accounts")
def monthly_account_breakdown(
    year: int = Query(...), month: int = Query(...),
    account_type: str = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _month_range(year, month)
    all_accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    accounts_map = {
        a.id: a for a in all_accounts
        if account_type is None or a.type == account_type
    }
    if account_type == "bank_account":
        txs = db.query(Transaction).filter(
            Transaction.date >= start, Transaction.date < end,
            Transaction.user_id == current_user.id,
        ).all()
        _excl = {"CC Payments", "Payment Received", "Refund"}
        filtered_txs = [
            t for t in txs
            if t.account_id in accounts_map and (
                (t.type == "expense" and t.category not in _excl)
                or t.category == "CC Payments"
            )
        ]
    else:
        txs = db.query(Transaction).filter(
            Transaction.date >= start, Transaction.date < end,
            Transaction.type == "expense",
            Transaction.user_id == current_user.id,
        ).all()
        filtered_txs = [t for t in txs if t.account_id in accounts_map] if account_type else txs
    return _account_breakdown(filtered_txs, accounts_map)


@router.get("/dashboard/monthly/accounts/income")
def monthly_income_account_breakdown(
    year: int = Query(...), month: int = Query(...),
    account_type: str = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _month_range(year, month)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.type == "income",
        Transaction.user_id == current_user.id,
    ).all()
    all_accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    accounts_map = {
        a.id: a for a in all_accounts
        if account_type is None or a.type == account_type
    }
    filtered_txs = [t for t in txs if t.account_id in accounts_map] if account_type else txs
    return _account_breakdown(filtered_txs, accounts_map)


@router.get("/dashboard/monthly/accounts/cc-net")
def monthly_cc_net_breakdown(
    year: int = Query(...), month: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _month_range(year, month)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {
        a.id: a for a in db.query(Account).filter(
            Account.type == "credit_card", Account.user_id == current_user.id
        ).all()
    }
    totals: dict = {}
    for t in txs:
        if t.account_id not in accounts_map:
            continue
        if t.category == "Payment Received":
            continue
        acct = accounts_map[t.account_id]
        key = t.account_id
        if key not in totals:
            totals[key] = {"name": acct.name, "color": acct.color, "last4": acct.last4, "amount": 0.0}
        if t.type == "expense":
            totals[key]["amount"] += t.amount
        elif t.type == "income":
            totals[key]["amount"] -= t.amount
    result = sorted(totals.values(), key=lambda x: -x["amount"])
    for r in result:
        r["amount"] = round(r["amount"], 2)
    return result


@router.get("/dashboard/yearly")
def yearly_dashboard(
    year: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = date_type(year, 1, 1)
    end = date_type(year + 1, 1, 1)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}

    monthly: dict[int, dict] = {m: {"income": 0.0, "expenses": 0.0} for m in range(1, 13)}

    for t in txs:
        m = t.date.month
        if t.type in _TRANSFER_TYPES and t.category != "CC Payments":
            continue
        if not t.account_id:
            continue
        acct = accounts_map.get(t.account_id)
        if acct is None or acct.type != "bank_account":
            continue
        if t.type == "income":
            monthly[m]["income"] += t.amount
        elif t.category == "CC Payments":
            monthly[m]["expenses"] += t.amount
        elif t.type == "expense":
            monthly[m]["expenses"] += t.amount

    months_list = []
    for m in range(1, 13):
        inc = monthly[m]["income"]
        exp = monthly[m]["expenses"]
        months_list.append({"month": m, "income": round(inc, 2), "expenses": round(exp, 2), "net": round(inc - exp, 2)})

    total_income = sum(d["income"] for d in monthly.values())
    total_expenses = sum(d["expenses"] for d in monthly.values())
    r = _aggregate_monthly(txs, accounts_map)
    bank_income    = r["bank_income"]
    total_expense  = r["bank_direct_exp"] + r["bank_cc_payments"]
    cc_net_charges = r["cc_spending"] - r["cc_refunds"]

    return {
        "months": months_list,
        "totals": {
            "income": round(total_income, 2),
            "expenses": round(total_expenses, 2),
            "net": round(total_income - total_expenses, 2),
            "savings_rate": round((total_income - total_expenses) / total_income * 100, 1)
            if total_income >= 1 else 0,
        },
        "by_account_type": {
            "bank_income":   round(bank_income, 2),
            "bank_spending": round(total_expense, 2),
            "cc_spending":   round(r["cc_spending"], 2),
            "cc_refunds":    round(r["cc_refunds"], 2),
            "net_cc":        round(cc_net_charges, 2),
        } if r["has_typed"] else None,
    }


@router.get("/dashboard/yearly/accounts")
def yearly_account_breakdown(
    year: int = Query(...),
    account_type: str = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = date_type(year, 1, 1)
    end = date_type(year + 1, 1, 1)
    all_accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    accounts_map = {a.id: a for a in all_accounts if account_type is None or a.type == account_type}
    if account_type == "bank_account":
        txs = db.query(Transaction).filter(
            Transaction.date >= start, Transaction.date < end,
            Transaction.user_id == current_user.id,
        ).all()
        _excl = {"CC Payments", "Payment Received", "Refund"}
        filtered_txs = [
            t for t in txs
            if t.account_id in accounts_map and (
                (t.type == "expense" and t.category not in _excl)
                or t.category == "CC Payments"
            )
        ]
    else:
        txs = db.query(Transaction).filter(
            Transaction.date >= start, Transaction.date < end,
            Transaction.type == "expense",
            Transaction.user_id == current_user.id,
        ).all()
        filtered_txs = [t for t in txs if t.account_id in accounts_map] if account_type else txs
    return _account_breakdown(filtered_txs, accounts_map)


@router.get("/dashboard/yearly/accounts/income")
def yearly_income_account_breakdown(
    year: int = Query(...),
    account_type: str = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = date_type(year, 1, 1)
    end = date_type(year + 1, 1, 1)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.type == "income",
        Transaction.user_id == current_user.id,
    ).all()
    all_accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    accounts_map = {a.id: a for a in all_accounts if account_type is None or a.type == account_type}
    filtered_txs = [t for t in txs if t.account_id in accounts_map] if account_type else txs
    return _account_breakdown(filtered_txs, accounts_map)


@router.get("/dashboard/yearly/accounts/cc-net")
def yearly_cc_net_breakdown(
    year: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = date_type(year, 1, 1)
    end = date_type(year + 1, 1, 1)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {
        a.id: a for a in db.query(Account).filter(
            Account.type == "credit_card", Account.user_id == current_user.id
        ).all()
    }
    totals: dict = {}
    for t in txs:
        if t.account_id not in accounts_map:
            continue
        if t.category == "Payment Received":
            continue
        acct = accounts_map[t.account_id]
        key = t.account_id
        if key not in totals:
            totals[key] = {"name": acct.name, "color": acct.color, "last4": acct.last4, "amount": 0.0}
        if t.type == "expense":
            totals[key]["amount"] += t.amount
        elif t.type == "income":
            totals[key]["amount"] -= t.amount
    result = sorted(totals.values(), key=lambda x: -x["amount"])
    for r in result:
        r["amount"] = round(r["amount"], 2)
    return result


@router.get("/dashboard/monthly/context")
def monthly_context(
    year: int = Query(...),
    month: int = Query(...),
    count: int = Query(6),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from datetime import date as d
    months: list[tuple[int, int]] = []
    y, m = year, month
    for _ in range(count):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1

    start_y, start_m = months[-1]
    start = d(start_y, start_m, 1)
    end_y, end_m = months[0]
    end = d(end_y + 1, 1, 1) if end_m == 12 else d(end_y, end_m + 1, 1)

    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}

    buckets: dict[tuple[int, int], dict] = {(y2, m2): {"income": 0.0, "expenses": 0.0} for y2, m2 in months}

    for t in txs:
        key = (t.date.year, t.date.month)
        if key not in buckets:
            continue
        if t.type in _TRANSFER_TYPES and t.category != "CC Payments":
            continue
        if not t.account_id:
            continue
        acct = accounts_map.get(t.account_id)
        if acct is None or acct.type != "bank_account":
            continue
        if t.type == "income":
            buckets[key]["income"] += t.amount
        elif t.category == "CC Payments":
            buckets[key]["expenses"] += t.amount
        elif t.type == "expense":
            buckets[key]["expenses"] += t.amount

    result = []
    for y2, m2 in reversed(months):
        inc = buckets[(y2, m2)]["income"]
        exp = buckets[(y2, m2)]["expenses"]
        result.append({"month": m2, "year": y2, "income": round(inc, 2), "expenses": round(exp, 2), "net": round(inc - exp, 2)})
    return result


@router.get("/dashboard/yearly/categories")
def yearly_categories(
    year: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = date_type(year, 1, 1)
    end = date_type(year + 1, 1, 1)
    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.type == "expense",
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}

    categories_bank: dict[str, float] = {}
    categories_cc: dict[str, float] = {}

    for t in txs:
        if t.category in ("CC Payments", "Payment Received"):
            continue
        if not t.account_id:
            continue
        acct = accounts_map.get(t.account_id)
        if acct is None:
            continue
        if acct.type == "bank_account":
            categories_bank[t.category] = categories_bank.get(t.category, 0) + t.amount
        elif acct.type == "credit_card":
            categories_cc[t.category] = categories_cc.get(t.category, 0) + t.amount

    categories_all: dict[str, float] = {}
    for k, v in categories_bank.items():
        categories_all[k] = categories_all.get(k, 0) + v
    for k, v in categories_cc.items():
        categories_all[k] = categories_all.get(k, 0) + v

    return {"all": _sort_cats(categories_all), "bank": _sort_cats(categories_bank), "cc": _sort_cats(categories_cc)}


@router.get("/dashboard/cc-payments-by-card")
def cc_payments_by_card(
    year: int = Query(...),
    month: int = Query(None),
    count: int = Query(12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from datetime import timedelta

    if month is not None:
        months: list[tuple[int, int]] = []
        y, m = year, month
        for _ in range(count):
            months.append((y, m))
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        months = list(reversed(months))
    else:
        months = [(year, m) for m in range(1, 13)]

    start_y, start_m = months[0]
    end_y, end_m = months[-1]
    start = date_type(start_y, start_m, 1)
    end = date_type(end_y + 1, 1, 1) if end_m == 12 else date_type(end_y, end_m + 1, 1)

    fetch_start = start - timedelta(days=5)
    fetch_end   = end   + timedelta(days=5)

    all_txs = db.query(Transaction).filter(
        Transaction.date >= fetch_start, Transaction.date < fetch_end,
        Transaction.user_id == current_user.id,
    ).all()

    all_accounts = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}
    cc_accounts  = {aid: a for aid, a in all_accounts.items() if a.type == "credit_card"}

    bank_payments = [
        t for t in all_txs
        if t.category == "CC Payments"
        and t.account_id in all_accounts
        and all_accounts[t.account_id].type == "bank_account"
    ]
    cc_received = [
        t for t in all_txs
        if t.category == "Payment Received" and t.account_id in cc_accounts
    ]

    unmatched_pool = list(cc_received)
    buckets: dict[tuple[int, int], dict] = {(y2, m2): {} for y2, m2 in months}

    for bp in bank_payments:
        month_key = (bp.date.year, bp.date.month)
        if month_key not in buckets:
            continue
        best_idx = None
        best_delta = timedelta(days=6)
        for i, cr in enumerate(unmatched_pool):
            if abs(cr.amount - bp.amount) > 0.01:
                continue
            delta = abs(cr.date - bp.date)
            if delta < best_delta:
                best_delta = delta
                best_idx = i
        bucket = buckets[month_key]
        if best_idx is not None:
            matched_cr = unmatched_pool.pop(best_idx)
            acct_id = matched_cr.account_id
            acct = cc_accounts[acct_id]
            if acct_id not in bucket:
                label = f"{acct.name}{f' ···{acct.last4}' if acct.last4 else ''}"
                bucket[acct_id] = {"name": label, "color": acct.color, "amount": 0.0}
            bucket[acct_id]["amount"] += bp.amount
        else:
            if "unmatched" not in bucket:
                bucket["unmatched"] = {"name": "Other / Unmatched", "color": "#a89268", "amount": 0.0}
            bucket["unmatched"]["amount"] += bp.amount

    result = []
    for y2, m2 in months:
        bucket = buckets[(y2, m2)]
        cards = sorted(
            [{"id": str(k), "name": v["name"], "color": v["color"], "amount": round(v["amount"], 2)}
             for k, v in bucket.items()],
            key=lambda x: -x["amount"]
        )
        total = round(sum(c["amount"] for c in cards), 2)
        result.append({"month": m2, "year": y2, "total": total, "cards": cards})
    return result


@router.get("/dashboard/cc-monthly")
def cc_monthly_trend(
    year: int = Query(...),
    month: int = Query(None),
    count: int = Query(12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if month is not None:
        months: list[tuple[int, int]] = []
        y, m = year, month
        for _ in range(count):
            months.append((y, m))
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        months = list(reversed(months))
    else:
        months = [(year, m) for m in range(1, 13)]

    start_y, start_m = months[0]
    end_y, end_m = months[-1]
    start = date_type(start_y, start_m, 1)
    end = date_type(end_y + 1, 1, 1) if end_m == 12 else date_type(end_y, end_m + 1, 1)

    txs = db.query(Transaction).filter(
        Transaction.date >= start, Transaction.date < end,
        Transaction.user_id == current_user.id,
    ).all()
    accounts_map = {
        a.id: a for a in db.query(Account).filter(
            Account.type == "credit_card", Account.user_id == current_user.id
        ).all()
    }

    buckets: dict[tuple[int, int], dict[int, dict]] = {(y2, m2): {} for y2, m2 in months}

    for t in txs:
        if t.account_id not in accounts_map:
            continue
        if t.category == "Payment Received":
            continue
        key = (t.date.year, t.date.month)
        if key not in buckets:
            continue
        acct_buckets = buckets[key]
        if t.account_id not in acct_buckets:
            acct_buckets[t.account_id] = {"cc_spending": 0.0, "cc_refunds": 0.0}
        if t.type == "expense":
            acct_buckets[t.account_id]["cc_spending"] += t.amount
        elif t.type == "income":
            acct_buckets[t.account_id]["cc_refunds"] += t.amount

    result = []
    for y2, m2 in months:
        acct_buckets = buckets[(y2, m2)]
        accounts_list = []
        for acct_id, vals in acct_buckets.items():
            acct = accounts_map[acct_id]
            sp = vals["cc_spending"]
            rf = vals["cc_refunds"]
            accounts_list.append({
                "name": acct.name, "last4": acct.last4, "color": acct.color,
                "cc_spending": round(sp, 2), "cc_refunds": round(rf, 2), "net_cc": round(sp - rf, 2),
            })
        accounts_list.sort(key=lambda x: -x["cc_spending"])
        total_sp = sum(a["cc_spending"] for a in accounts_list)
        total_rf = sum(a["cc_refunds"] for a in accounts_list)
        result.append({
            "month": m2, "year": y2,
            "cc_spending": round(total_sp, 2), "cc_refunds": round(total_rf, 2),
            "net_cc": round(total_sp - total_rf, 2), "accounts": accounts_list,
        })
    return result


@router.get("/dashboard/years")
def available_years(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from sqlalchemy import distinct, extract, func
    rows = db.query(distinct(extract("year", Transaction.date))).filter(
        Transaction.user_id == current_user.id
    ).order_by(extract("year", Transaction.date).desc()).all()
    years = [int(r[0]) for r in rows]
    if not years:
        import datetime
        today = datetime.date.today()
        return {"years": [today.year], "latest_year": today.year, "latest_month": today.month}

    latest_row = db.query(func.max(Transaction.date)).filter(
        Transaction.user_id == current_user.id
    ).scalar()
    if latest_row:
        latest_year = latest_row.year
        latest_month = latest_row.month
    else:
        import datetime
        today = datetime.date.today()
        latest_year, latest_month = today.year, today.month

    return {"years": years, "latest_year": latest_year, "latest_month": latest_month}
