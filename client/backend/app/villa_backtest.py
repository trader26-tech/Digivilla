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

# The rent-like income the villa targets, as a % of ticket per year (6% p.a.).
RENT_YIELD = 0.06


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

    # per-fund index
    per_fund = {}
    for f in VILLA_FUNDS:
        idx = _index_from_monthly(months, monthlies[f["key"]])
        per_fund[f["key"]] = {
            "name": f["name"], "role": f["role"], "weight": f["weight"],
            "index": idx, "mult": round(idx[-1] / 100.0, 2),
        }

    # blended index = weighted sum of each fund's index at every month
    blend = []
    for i in range(len(months)):
        v = sum(per_fund[f["key"]]["index"][i] * f["weight"] for f in VILLA_FUNDS)
        blend.append(round(v, 2))
    blend_mult = round(blend[-1] / 100.0, 2)

    # worst drawdown of the blend
    peak = blend[0]
    worst = 0.0
    for v in blend:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1.0)

    # summary: `amount` invested at the start
    final_value = round(amount * blend_mult)
    total_return_pct = round((blend_mult - 1.0) * 100.0)
    monthly_income = round(amount * RENT_YIELD / 12.0)

    return {
        "ok": True,
        "dates": months,
        "blend_index": blend,
        "blend_mult": blend_mult,
        "worst_drawdown": round(worst * 100.0, 1),
        "per_fund": per_fund,
        "summary": {
            "invested": round(amount),
            "final_value": final_value,
            "total_return_pct": total_return_pct,
            "monthly_income": monthly_income,
            "years": round(len(months) / 12.0, 1),
            "start": months[0],
            "end": months[-1],
        },
    }
