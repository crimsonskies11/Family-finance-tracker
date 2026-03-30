"""Unit tests for the family finance tracker."""

import pytest
from tracker import (
    add_transaction,
    list_transactions,
    delete_transaction,
    set_budget,
    get_budget,
    monthly_summary,
    budget_alerts,
)


def empty_data():
    return {"transactions": [], "budgets": {}}


# ---------------------------------------------------------------------------
# add_transaction
# ---------------------------------------------------------------------------

def test_add_expense():
    data = empty_data()
    txn = add_transaction(data, "expense", 50.0, "food", "Groceries", "2026-03-01")
    assert txn["type"] == "expense"
    assert txn["amount"] == 50.0
    assert txn["category"] == "food"
    assert len(data["transactions"]) == 1


def test_add_income():
    data = empty_data()
    txn = add_transaction(data, "income", 2000.0, "income", "Salary", "2026-03-01")
    assert txn["type"] == "income"
    assert txn["amount"] == 2000.0


def test_add_multiple_ids_are_sequential():
    data = empty_data()
    t1 = add_transaction(data, "expense", 10.0, "food", "Coffee", "2026-03-01")
    t2 = add_transaction(data, "expense", 20.0, "food", "Lunch", "2026-03-02")
    assert t1["id"] == 1
    assert t2["id"] == 2


def test_amount_is_rounded():
    data = empty_data()
    txn = add_transaction(data, "expense", 10.999, "food", "Snack", "2026-03-01")
    assert txn["amount"] == 11.0


# ---------------------------------------------------------------------------
# list_transactions
# ---------------------------------------------------------------------------

def test_list_all():
    data = empty_data()
    add_transaction(data, "expense", 10.0, "food", "a", "2026-03-01")
    add_transaction(data, "income", 100.0, "income", "b", "2026-04-01")
    assert len(list_transactions(data)) == 2


def test_list_filter_month():
    data = empty_data()
    add_transaction(data, "expense", 10.0, "food", "a", "2026-03-15")
    add_transaction(data, "expense", 20.0, "food", "b", "2026-04-01")
    results = list_transactions(data, month="2026-03")
    assert len(results) == 1
    assert results[0]["description"] == "a"


def test_list_filter_type():
    data = empty_data()
    add_transaction(data, "expense", 10.0, "food", "a", "2026-03-01")
    add_transaction(data, "income", 100.0, "income", "b", "2026-03-01")
    expenses = list_transactions(data, kind="expense")
    assert all(t["type"] == "expense" for t in expenses)
    assert len(expenses) == 1


def test_list_filter_category():
    data = empty_data()
    add_transaction(data, "expense", 10.0, "food", "a", "2026-03-01")
    add_transaction(data, "expense", 20.0, "transport", "b", "2026-03-01")
    results = list_transactions(data, category="food")
    assert len(results) == 1
    assert results[0]["category"] == "food"


# ---------------------------------------------------------------------------
# delete_transaction
# ---------------------------------------------------------------------------

def test_delete_existing():
    data = empty_data()
    add_transaction(data, "expense", 10.0, "food", "a", "2026-03-01")
    assert delete_transaction(data, 1) is True
    assert data["transactions"] == []


def test_delete_nonexistent():
    data = empty_data()
    assert delete_transaction(data, 999) is False


# ---------------------------------------------------------------------------
# budget helpers
# ---------------------------------------------------------------------------

def test_set_and_get_budget():
    data = empty_data()
    set_budget(data, "food", 300.0, "2026-03")
    assert get_budget(data, "food", "2026-03") == 300.0


def test_get_budget_unset_returns_zero():
    data = empty_data()
    assert get_budget(data, "food", "2026-03") == 0.0


def test_budget_overwrite():
    data = empty_data()
    set_budget(data, "food", 300.0, "2026-03")
    set_budget(data, "food", 400.0, "2026-03")
    assert get_budget(data, "food", "2026-03") == 400.0


# ---------------------------------------------------------------------------
# monthly_summary
# ---------------------------------------------------------------------------

def test_summary_totals():
    data = empty_data()
    add_transaction(data, "income", 3000.0, "income", "Salary", "2026-03-01")
    add_transaction(data, "expense", 500.0, "food", "Groceries", "2026-03-05")
    add_transaction(data, "expense", 100.0, "transport", "Bus pass", "2026-03-10")
    summary = monthly_summary(data, "2026-03")
    assert summary["total_income"] == 3000.0
    assert summary["total_expenses"] == 600.0
    assert summary["net"] == 2400.0


def test_summary_by_category():
    data = empty_data()
    add_transaction(data, "expense", 200.0, "food", "Shop", "2026-03-01")
    add_transaction(data, "expense", 50.0, "food", "Market", "2026-03-10")
    summary = monthly_summary(data, "2026-03")
    assert summary["by_category"]["food"]["spent"] == 250.0


def test_summary_empty_month():
    data = empty_data()
    summary = monthly_summary(data, "2026-03")
    assert summary["total_income"] == 0.0
    assert summary["total_expenses"] == 0.0
    assert summary["net"] == 0.0


def test_summary_excludes_other_months():
    data = empty_data()
    add_transaction(data, "expense", 100.0, "food", "a", "2026-02-28")
    add_transaction(data, "expense", 200.0, "food", "b", "2026-03-01")
    summary = monthly_summary(data, "2026-03")
    assert summary["total_expenses"] == 200.0


# ---------------------------------------------------------------------------
# budget_alerts
# ---------------------------------------------------------------------------

def test_budget_alerts_over():
    data = empty_data()
    add_transaction(data, "expense", 400.0, "food", "a", "2026-03-01")
    set_budget(data, "food", 300.0, "2026-03")
    summary = monthly_summary(data, "2026-03")
    alerts = budget_alerts(summary)
    assert len(alerts) == 1
    assert "OVER BUDGET" in alerts[0]
    assert "food" in alerts[0]


def test_budget_alerts_under():
    data = empty_data()
    add_transaction(data, "expense", 200.0, "food", "a", "2026-03-01")
    set_budget(data, "food", 300.0, "2026-03")
    summary = monthly_summary(data, "2026-03")
    alerts = budget_alerts(summary)
    assert alerts == []


def test_budget_alerts_no_budget_set():
    data = empty_data()
    add_transaction(data, "expense", 999.0, "food", "a", "2026-03-01")
    summary = monthly_summary(data, "2026-03")
    alerts = budget_alerts(summary)
    assert alerts == []
