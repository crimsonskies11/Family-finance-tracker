"""Family Finance Tracker - CLI application for managing household finances."""

import json
import os
import sys
from datetime import datetime, date
from collections import defaultdict

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")

CATEGORIES = [
    "housing",
    "food",
    "transport",
    "utilities",
    "healthcare",
    "education",
    "entertainment",
    "clothing",
    "savings",
    "income",
    "other",
]


# ---------------------------------------------------------------------------
# Data layer
# ---------------------------------------------------------------------------

def load_data() -> dict:
    if not os.path.exists(DATA_FILE):
        return {"transactions": [], "budgets": {}}
    with open(DATA_FILE) as f:
        return json.load(f)


def save_data(data: dict) -> None:
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)


# ---------------------------------------------------------------------------
# Transaction helpers
# ---------------------------------------------------------------------------

def add_transaction(data: dict, kind: str, amount: float, category: str,
                    description: str, txn_date: str) -> dict:
    """Add a new income or expense transaction."""
    transaction = {
        "id": len(data["transactions"]) + 1,
        "type": kind,           # "income" | "expense"
        "amount": round(amount, 2),
        "category": category,
        "description": description,
        "date": txn_date,
    }
    data["transactions"].append(transaction)
    return transaction


def list_transactions(data: dict, month: str = None, kind: str = None,
                      category: str = None) -> list:
    """Return transactions filtered by optional month (YYYY-MM), type, or category."""
    txns = data["transactions"]
    if month:
        txns = [t for t in txns if t["date"].startswith(month)]
    if kind:
        txns = [t for t in txns if t["type"] == kind]
    if category:
        txns = [t for t in txns if t["category"] == category]
    return txns


def delete_transaction(data: dict, txn_id: int) -> bool:
    """Remove a transaction by its ID. Returns True if found and deleted."""
    before = len(data["transactions"])
    data["transactions"] = [t for t in data["transactions"] if t["id"] != txn_id]
    return len(data["transactions"]) < before


# ---------------------------------------------------------------------------
# Budget helpers
# ---------------------------------------------------------------------------

def set_budget(data: dict, category: str, amount: float, month: str) -> None:
    """Set or update a monthly budget limit for a category."""
    key = f"{month}:{category}"
    data["budgets"][key] = round(amount, 2)


def get_budget(data: dict, category: str, month: str) -> float:
    """Return the budget limit for a category/month, or 0 if unset."""
    return data["budgets"].get(f"{month}:{category}", 0.0)


# ---------------------------------------------------------------------------
# Summary / reporting
# ---------------------------------------------------------------------------

def monthly_summary(data: dict, month: str) -> dict:
    """
    Compute a summary for the given month (YYYY-MM).

    Returns a dict with:
        total_income, total_expenses, net,
        by_category: {category: {"spent": x, "budget": y}}
    """
    txns = list_transactions(data, month=month)

    total_income = sum(t["amount"] for t in txns if t["type"] == "income")
    total_expenses = sum(t["amount"] for t in txns if t["type"] == "expense")

    by_category: dict[str, dict] = defaultdict(lambda: {"spent": 0.0, "budget": 0.0})
    for t in txns:
        if t["type"] == "expense":
            by_category[t["category"]]["spent"] += t["amount"]

    for cat in by_category:
        by_category[cat]["budget"] = get_budget(data, cat, month)

    return {
        "month": month,
        "total_income": round(total_income, 2),
        "total_expenses": round(total_expenses, 2),
        "net": round(total_income - total_expenses, 2),
        "by_category": dict(by_category),
    }


def budget_alerts(summary: dict) -> list[str]:
    """Return warning strings for categories that have exceeded their budget."""
    alerts = []
    for cat, info in summary["by_category"].items():
        if info["budget"] > 0 and info["spent"] > info["budget"]:
            over = info["spent"] - info["budget"]
            alerts.append(
                f"  [OVER BUDGET] {cat}: spent ${info['spent']:.2f} / "
                f"budget ${info['budget']:.2f} (${over:.2f} over)"
            )
    return alerts


# ---------------------------------------------------------------------------
# CLI display helpers
# ---------------------------------------------------------------------------

def print_table(rows: list[dict]) -> None:
    if not rows:
        print("  (no transactions)")
        return
    headers = ["ID", "Date", "Type", "Category", "Amount", "Description"]
    col_data = [
        [str(r["id"]), r["date"], r["type"], r["category"],
         f"${r['amount']:.2f}", r["description"]]
        for r in rows
    ]
    widths = [len(h) for h in headers]
    for row in col_data:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    fmt = "  " + "  ".join(f"{{:<{w}}}" for w in widths)
    sep = "  " + "  ".join("-" * w for w in widths)
    print(fmt.format(*headers))
    print(sep)
    for row in col_data:
        print(fmt.format(*row))


def print_summary(summary: dict) -> None:
    print(f"\n=== Summary for {summary['month']} ===")
    print(f"  Income   : ${summary['total_income']:.2f}")
    print(f"  Expenses : ${summary['total_expenses']:.2f}")
    print(f"  Net      : ${summary['net']:.2f}")
    if summary["by_category"]:
        print("\n  By category:")
        for cat, info in sorted(summary["by_category"].items()):
            budget_str = f" / budget ${info['budget']:.2f}" if info["budget"] else ""
            print(f"    {cat:<14} ${info['spent']:.2f}{budget_str}")
    alerts = budget_alerts(summary)
    if alerts:
        print("\n  Budget alerts:")
        for a in alerts:
            print(a)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

USAGE = """
Usage:
  tracker.py add expense <amount> <category> <description> [YYYY-MM-DD]
  tracker.py add income  <amount> <category> <description> [YYYY-MM-DD]
  tracker.py list [--month YYYY-MM] [--type income|expense] [--category CAT]
  tracker.py delete <id>
  tracker.py summary [YYYY-MM]
  tracker.py budget set <category> <amount> [YYYY-MM]
  tracker.py categories

Categories: """ + ", ".join(CATEGORIES)


def current_month() -> str:
    return date.today().strftime("%Y-%m")


def parse_date(s: str) -> str:
    datetime.strptime(s, "%Y-%m-%d")   # validates format
    return s


def cmd_add(args: list[str], data: dict) -> None:
    if len(args) < 4:
        print("Usage: tracker.py add <expense|income> <amount> <category> <description> [date]")
        sys.exit(1)
    kind, raw_amount, category = args[0], args[1], args[2]
    description = args[3]
    txn_date = args[4] if len(args) > 4 else date.today().isoformat()

    if kind not in ("income", "expense"):
        print(f"Type must be 'income' or 'expense', got: {kind}")
        sys.exit(1)
    try:
        amount = float(raw_amount)
        if amount <= 0:
            raise ValueError
    except ValueError:
        print(f"Amount must be a positive number, got: {raw_amount}")
        sys.exit(1)
    if category not in CATEGORIES:
        print(f"Unknown category '{category}'. Valid: {', '.join(CATEGORIES)}")
        sys.exit(1)
    try:
        txn_date = parse_date(txn_date)
    except ValueError:
        print(f"Date must be YYYY-MM-DD, got: {txn_date}")
        sys.exit(1)

    txn = add_transaction(data, kind, amount, category, description, txn_date)
    save_data(data)
    print(f"Added #{txn['id']}: {kind} ${amount:.2f} [{category}] on {txn_date}")


def cmd_list(args: list[str], data: dict) -> None:
    month = kind = category = None
    i = 0
    while i < len(args):
        if args[i] == "--month" and i + 1 < len(args):
            month = args[i + 1]; i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            kind = args[i + 1]; i += 2
        elif args[i] == "--category" and i + 1 < len(args):
            category = args[i + 1]; i += 2
        else:
            i += 1

    rows = list_transactions(data, month=month, kind=kind, category=category)
    print(f"\n{len(rows)} transaction(s):\n")
    print_table(rows)


def cmd_delete(args: list[str], data: dict) -> None:
    if not args:
        print("Usage: tracker.py delete <id>")
        sys.exit(1)
    try:
        txn_id = int(args[0])
    except ValueError:
        print(f"ID must be an integer, got: {args[0]}")
        sys.exit(1)
    if delete_transaction(data, txn_id):
        save_data(data)
        print(f"Deleted transaction #{txn_id}")
    else:
        print(f"No transaction found with ID {txn_id}")
        sys.exit(1)


def cmd_summary(args: list[str], data: dict) -> None:
    month = args[0] if args else current_month()
    summary = monthly_summary(data, month)
    print_summary(summary)


def cmd_budget(args: list[str], data: dict) -> None:
    if len(args) < 3 or args[0] != "set":
        print("Usage: tracker.py budget set <category> <amount> [YYYY-MM]")
        sys.exit(1)
    category, raw_amount = args[1], args[2]
    month = args[3] if len(args) > 3 else current_month()
    if category not in CATEGORIES:
        print(f"Unknown category '{category}'. Valid: {', '.join(CATEGORIES)}")
        sys.exit(1)
    try:
        amount = float(raw_amount)
        if amount < 0:
            raise ValueError
    except ValueError:
        print(f"Amount must be a non-negative number, got: {raw_amount}")
        sys.exit(1)
    set_budget(data, category, amount, month)
    save_data(data)
    print(f"Budget set: {category} = ${amount:.2f} for {month}")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(USAGE)
        sys.exit(0)

    data = load_data()
    command = args[0]
    rest = args[1:]

    if command == "add":
        cmd_add(rest, data)
    elif command == "list":
        cmd_list(rest, data)
    elif command == "delete":
        cmd_delete(rest, data)
    elif command == "summary":
        cmd_summary(rest, data)
    elif command == "budget":
        cmd_budget(rest, data)
    elif command == "categories":
        print("Available categories: " + ", ".join(CATEGORIES))
    else:
        print(f"Unknown command: {command}")
        print(USAGE)
        sys.exit(1)


if __name__ == "__main__":
    main()
