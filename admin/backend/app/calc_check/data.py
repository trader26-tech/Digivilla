"""The history the calculators run on (the client's GET /calc/villa-funds), the
villa weights from the settings, and the "Data used" tab."""

from __future__ import annotations

import time

import httpx

from app.config import get_settings
from app.calc_check.settings import _cfg


_vf: tuple[float, dict] | None = None

def villa_funds() -> dict:
    """The month-end NAVs the client app's calculators download (public endpoint
    of the client service), cached 10 minutes — both checks use the same data."""
    global _vf
    if _vf and time.time() - _vf[0] < 600:
        return _vf[1]
    r = httpx.get(f"{get_settings().client_api_url.rstrip('/')}/calc/villa-funds", timeout=60)
    d = r.json()
    if not d.get("ok"):
        raise ValueError(d.get("detail") or "Fund history unavailable")
    _vf = (time.time(), d)
    return d

def _villa(pf: str) -> dict:
    """The history, weighted for one villa from the SETTINGS (series it doesn't hold get 0)."""
    cfg = _cfg()
    v = next((x for x in cfg["villas"] if x["key"] == pf), None) or next(x for x in cfg["villas"] if x["key"] == cfg["default_villa"])
    d = villa_funds()
    return {**d, "funds": [{**f, "weight": float(v["weights"].get(f["sleeve"], 0.0))} for f in d["funds"]]}

def data_used() -> dict:
    """Everything the calculators are fed: each series (what it is, where it comes
    from, its weight, first/last month), every month-end value, the rules."""
    d = villa_funds()
    series = []
    for f in d["funds"]:
        v = f["nav"]
        series.append({"sleeve": f["sleeve"], "name": f["name"], "source": f.get("source", ""),
                       "weight": f["weight"], "first": d["months"][0], "last": d["months"][-1],
                       "start_value": v[0], "end_value": v[-1],
                       "growth_x": round(v[-1] / v[0], 4) if v[0] else None,
                       "cagr": round(((v[-1] / v[0]) ** (12 / (len(v) - 1)) - 1) * 100, 2) if v[0] and len(v) > 1 else None})
    rows = [{"month": m, **{f["sleeve"]: f["nav"][i] for f in d["funds"]}} for i, m in enumerate(d["months"])]
    return {
        "basis": d.get("basis", "index"), "note": d.get("note"), "start": d["months"][0], "end": d["months"][-1],
        "series": series, "rows": rows,
        "rules": _rules_text(_cfg()),
    }

def _rules_text(c: dict) -> list[str]:
    """The rules, in words, written from the SETTINGS (so they can't drift)."""
    names = {"arbitrage": "arbitrage", "gold": "gold", "large": "Nifty 50", "mid": "Midcap 150", "small": "Smallcap 250"}
    nm = lambda xs: ", ".join(names.get(x, x) for x in xs)
    first = c["income"]["pay_first"]
    mix = lambda v: f"{round(100 - sum(v['weights'].get(k, 0) for k in first) * 100)}/{round(sum(v['weights'].get(k, 0) for k in first) * 100)}"
    t, w = c["tax"], c["withdrawals"]
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return [
        "Each part is its benchmark INDEX — no actively managed fund is used.",
        "Villas (growth / " + nm(first) + "): " + ", ".join(f"{v['name']} {mix(v)}" for v in c["villas"])
        + f". The weights shown are the default villa's ({c['default_villa']}).",
        "Month-end closes; only complete months.",
        f"SWP (FD / Lumpsum / Flat): {w['lumpsum_monthly_rate'] * 100:g}% of the amount a month (₹{1e7 * w['lumpsum_monthly_rate']:,.0f} per ₹1 Cr), "
        f"sold from {nm(first)} first, then the rest pro-rata. The tax on that sale comes out of the payout.",
        f"SIP: each month's amount buys every part by weight; with SWP on, {w['sip_yearly_rate'] * 100:g}% of the value is paid at each year end ({nm(first)} first).",
        f"Every 1 {months[c['rebalance']['month'] % 12]} (at the month-end close before it): {nm(first)} is left alone; "
        f"{nm(c['rebalance']['parts'])} go back to their starting split of (value − the tax on what that sells).",
        f"Sales take the oldest units first; each sale is charged the tax it adds to its financial year. Equity {t['equity_st_rate'] * 100:g}% ≤ {t['equity_lt_months']} months, "
        f"{t['equity_lt_rate'] * 100:g}% after (₹{t['equity_exempt']:,.0f} a year free); {nm(t['gold_parts'])} slab ≤ {t['gold_lt_months']} months, "
        f"{t['gold_lt_rate'] * 100:g}% after; +{t['cess'] * 100:g}% cess. No tax is taken off the final value.",
        "Index levels are before any fund's expense ratio.",
        f"Settings v{c.get('version')} · {c.get('updated_at', '')} · {c.get('updated_by', '')}",
    ]

def _window(d: dict, years: int) -> dict:
    months = d["months"]
    start = max(0, len(months) - 1 - 12 * years)
    return {"months": months[start:],
            "funds": [{**f, "nav": f["nav"][start:]} for f in d["funds"]]}
