"""Villa fund backtest — growth-of-₹100 for the villa's fixed 5-fund allocation.

Every villa holds the SAME concentration (only the ticket size differs):
    36%  Arbitrage        (SBI Arbitrage Fund)
    16%  Large Cap        \\
    16%  Mid Cap           }  the remaining 64%, split equally 4 ways
    16%  Small Cap        /
    16%  Gold FoF         (Nippon India Gold Savings)

Given real month-end NAVs (via basket_analytics._fetch_series), we build one
growth-of-₹100 index per fund plus the weighted blend, on the common window,
and a "what ₹X invested at the start would be worth today" summary.
"""

from __future__ import annotations

from app.basket_analytics import _fetch_series, _monthly

# --- the fixed villa allocation -------------------------------------------------
# scheme codes are AMFI (regular-growth) — the ones the desk actually sells.
VILLA_FUNDS = [
    {"key": "arbitrage", "name": "SBI Arbitrage Fund",        "code": 104457, "weight": 0.36, "role": "arbitrage"},
    {"key": "largecap",  "name": "Nippon India Large Cap",    "code": 101762, "weight": 0.16, "role": "equity"},
    {"key": "midcap",    "name": "Nippon India Mid Cap",      "code": 105758, "weight": 0.16, "role": "equity"},
    {"key": "smallcap",  "name": "Nippon India Small Cap",    "code": 113177, "weight": 0.16, "role": "equity"},
    {"key": "gold",      "name": "Nippon India Gold Savings", "code": 114616, "weight": 0.16, "role": "gold"},
]

# Monthly SWP paid to the user, as a % of the ticket PER MONTH.
# ₹10L → ₹3,000 · ₹50L → ₹15,000 · ₹1Cr → ₹30,000  (i.e. 0.3%/mo = 3.6%/yr).
SWP_MONTHLY_RATE = 0.003
# The SWP is withdrawn ONLY from the arbitrage sleeve; equity + gold never touched.
_ARBITRAGE_KEY = "arbitrage"
_GROWTH_KEYS = ["largecap", "midcap", "smallcap"]
_GOLD_KEY = "gold"


def _index_from_monthly(months: list[str], m: dict[str, float]) -> list[float]:
    """Growth-of-₹100 across the given month keys, rebased to 100 at the first."""
    base = m[months[0]]
    return [round(100.0 * m[k] / base, 2) for k in months]


def backtest(amount: float = 10_00_000) -> dict:
    """Per-fund + blended growth-of-₹100 on the common window, plus a summary of
    what `amount` invested at the start would be worth today."""
    # fetch + reduce each fund to month-end NAVs
    monthlies: dict[str, dict[str, float]] = {}
    for f in VILLA_FUNDS:
        series = _fetch_series(f["code"])
        monthlies[f["key"]] = _monthly(series) if series else {}

    # common window = months present in EVERY fund
    common = None
    for mm in monthlies.values():
        keys = set(mm.keys())
        common = keys if common is None else (common & keys)
    months = sorted(common) if common else []
    if len(months) < 24:
        return {"ok": False, "detail": "Not enough overlapping NAV history."}

    # NAV at each common month for each fund
    nav = {f["key"]: [monthlies[f["key"]][k] for k in months] for f in VILLA_FUNDS}
    n = len(months)

    # ── set up initial holdings: buy `amount × weight` of each fund at month 0 ──
    units = {f["key"]: (amount * f["weight"]) / nav[f["key"]][0] for f in VILLA_FUNDS}

    swp = amount * SWP_MONTHLY_RATE   # ₹ paid to the user every month

    # per-month value of each bucket after the SWP has been draining arbitrage
    arb_val, gold_val, eq_val = [], [], []
    income_paid = 0.0
    for i in range(n):
        # 1) pay this month's SWP by selling arbitrage units (only while it lasts)
        if i > 0 and units[_ARBITRAGE_KEY] > 0:
            price = nav[_ARBITRAGE_KEY][i]
            need_units = swp / price
            sold = min(need_units, units[_ARBITRAGE_KEY])
            units[_ARBITRAGE_KEY] -= sold
            income_paid += sold * price
        # 2) mark each bucket to market at this month's NAV
        arb_val.append(round(units[_ARBITRAGE_KEY] * nav[_ARBITRAGE_KEY][i]))
        gold_val.append(round(units[_GOLD_KEY] * nav[_GOLD_KEY][i]))
        eq_val.append(round(sum(units[k] * nav[k][i] for k in _GROWTH_KEYS)))

    # stacked bottom → top: ARBITRAGE first (it drains to zero), then gold, then equity
    bands = [
        {"key": "arbitrage", "name": "SBI Arbitrage Fund (pays you)", "color": "#3a7ca5", "values": arb_val},
        {"key": "gold",      "name": "Nippon India Gold Savings",     "color": "#c8862b", "values": gold_val},
        {"key": "equity",    "name": "Large + Mid + Small Cap",       "color": "#2e7d64", "values": eq_val},
    ]

    total = [arb_val[i] + gold_val[i] + eq_val[i] for i in range(n)]
    mult = round(total[-1] / amount, 2) if amount else 0

    peak = total[0]; worst = 0.0
    for v in total:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1.0)

    # when does the arbitrage sleeve run dry? (first month it hits ~0)
    arb_zero_month = None
    for i in range(n):
        if arb_val[i] <= max(1.0, amount * 0.001):
            arb_zero_month = months[i]
            break

    return {
        "ok": True,
        "dates": months,
        "bands": bands,          # stacked, bottom→top
        "total": total,
        "blend_mult": mult,
        "worst_drawdown": round(worst * 100.0, 1),
        "summary": {
            "invested": round(amount),
            "final_value": total[-1],
            "total_return_pct": round((mult - 1.0) * 100.0),
            "monthly_income": round(swp),
            "income_paid_total": round(income_paid),
            "arb_zero_month": arb_zero_month,
            "years": round(n / 12.0, 1),
            "start": months[0],
            "end": months[-1],
        },
    }
