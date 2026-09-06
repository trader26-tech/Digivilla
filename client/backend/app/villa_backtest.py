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

    # per-fund growth-of-₹100 index
    per_fund_index = {f["key"]: _index_from_monthly(months, monthlies[f["key"]]) for f in VILLA_FUNDS}

    # ── stacked bands: each band = its ₹ value over time (scaled to `amount`) ──
    # Equity = Large+Mid+Small combined (their weights); Gold; Arbitrage.
    # value_of(band) at month i = amount × Σ(weight_f × index_f[i]/100) over the band's funds.
    def band_values(keys: list[str]) -> list[float]:
        out = []
        for i in range(len(months)):
            v = sum(amount * f["weight"] * (per_fund_index[f["key"]][i] / 100.0)
                    for f in VILLA_FUNDS if f["key"] in keys)
            out.append(round(v))
        return out

    equity_keys = ["largecap", "midcap", "smallcap"]
    bands = [
        {"key": "equity",    "name": "Large + Mid + Small Cap", "color": "#2e7d64", "values": band_values(equity_keys)},
        {"key": "gold",      "name": "Nippon India Gold Savings", "color": "#c8862b", "values": band_values(["gold"])},
        {"key": "arbitrage", "name": "SBI Arbitrage Fund",        "color": "#3a7ca5", "values": band_values(["arbitrage"])},
    ]

    # total portfolio value over time (sum of bands)
    total = [round(sum(b["values"][i] for b in bands)) for i in range(len(months))]
    blend_mult = round(total[-1] / amount, 2) if amount else 0

    # worst drawdown of the total
    peak = total[0]; worst = 0.0
    for v in total:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1.0)

    return {
        "ok": True,
        "dates": months,
        "bands": bands,          # stacked, bottom→top order as given
        "total": total,
        "blend_mult": blend_mult,
        "worst_drawdown": round(worst * 100.0, 1),
        "summary": {
            "invested": round(amount),
            "final_value": total[-1],
            "total_return_pct": round((blend_mult - 1.0) * 100.0),
            "monthly_income": round(amount * RENT_YIELD / 12.0),
            "years": round(len(months) / 12.0, 1),
            "start": months[0],
            "end": months[-1],
        },
    }
