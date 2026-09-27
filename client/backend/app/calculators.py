"""Calculators — "what if this money had gone into my basket instead?"

`basket_growth(owner, amount, start)` models a LUMP SUM of `amount` put into the
user's OWN fund basket (their villa mix, else the standard mix) at the end of the
month `start` falls in, held without rebalancing, marked to real month-end NAVs up
to today. Returns the value path, today's value and the CAGR.

Funds younger than the purchase date are BACKFILLED with a long-history fund of the
same sleeve (e.g. a 2020 small-cap uses Nippon India Small Cap before 2020, and HDFC
Mid Cap before 2010). Each fund reports which stand-in was used and until when, so
the UI can say so. mfapi history starts in 2006 and the oldest gold fund in 2007, so
the earliest modelled start is ~mid-2007; an earlier start is clamped and flagged.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Optional

# Long-history stand-ins per sleeve, tried in order (all Regular-Growth, AMFI codes,
# verified against mfapi 2026-09-27: name + first NAV date).
SLEEVE_PROXIES: dict[str, list[tuple[int, str]]] = {
    "arbitrage": [(104457, "SBI Arbitrage Fund")],                  # from Nov 2006
    "large":     [(103504, "SBI Large Cap Fund")],                  # from Apr 2006
    "mid":       [(105758, "HDFC Mid Cap Fund")],                   # from Jul 2007
    "small":     [(113177, "Nippon India Small Cap Fund"),          # from Sep 2010
                  (105758, "HDFC Mid Cap Fund")],
    "gold":      [(114616, "Nippon India Gold Savings Fund"),       # from Mar 2011
                  (105085, "Gold BeES (gold ETF)")],                # Mar 2007 – Aug 2011
    "other":     [(102885, "SBI Aggressive Hybrid Fund")],          # from Apr 2006
}

# Used when the user has no basket yet (standard villa concentration).
STANDARD_MIX = [
    {"name": "SBI Arbitrage Fund", "scheme_code": 104457, "sleeve": "arbitrage", "allocation": 36},
    {"name": "SBI Large Cap Fund", "scheme_code": 103504, "sleeve": "large", "allocation": 16},
    {"name": "HDFC Mid Cap Fund", "scheme_code": 105758, "sleeve": "mid", "allocation": 16},
    {"name": "Nippon India Small Cap Fund", "scheme_code": 113177, "sleeve": "small", "allocation": 16},
    {"name": "Nippon India Gold Savings Fund", "scheme_code": 114616, "sleeve": "gold", "allocation": 16},
]


def _monthly(code: int) -> dict[str, float]:
    """Month-end NAV keyed 'YYYY-MM' (last NAV in the month; the current month's
    entry is the latest NAV, so the path always ends at today's value)."""
    from app.client_portfolio import _fetch_full_nav_memo
    out: dict[str, float] = {}
    for p in _fetch_full_nav_memo(int(code)) or []:
        d = p.date if isinstance(p.date, str) else p.date.isoformat()
        out[d[:7]] = float(p.nav)
    return out


def _splice(own: dict[str, float], proxies: list[tuple[str, dict[str, float]]]) -> tuple[dict[str, float], list[dict]]:
    """Extend `own` backwards month by month using each proxy's monthly returns.
    Returns (index by month, [{name, until}] — the stand-ins actually used)."""
    idx = dict(own)
    used: list[dict] = []
    for name, prox in proxies:
        if not idx:
            idx = dict(prox)
            continue
        first = min(idx)
        earlier = sorted(k for k in prox if k < first)
        if first not in prox or not earlier:
            continue
        val, nxt = idx[first], first
        for k in reversed(earlier):                 # walk back in time
            val = val * prox[k] / prox[nxt]
            idx[k] = val
            nxt = k
        used.append({"name": name, "until": first})
    return idx, used


def _basket_funds(owner: Optional[str]) -> tuple[list[dict], bool]:
    """The user's basket (sleeve + weight per fund), or the standard mix."""
    funds: list[dict] = []
    if owner:
        try:
            from app.client_portfolio import allocation_summary
            funds = [f for f in (allocation_summary(owner).get("funds") or [])
                     if f.get("scheme_code") and (f.get("allocation") or 0) > 0]
        except Exception:
            funds = []
    return (funds, True) if funds else ([dict(f) for f in STANDARD_MIX], False)


_memo: dict = {}
_MEMO_TTL = 3600


def basket_growth(owner: Optional[str], amount: float, start: date) -> dict:
    funds, is_own = _basket_funds(owner)
    key = (tuple((int(f["scheme_code"]), round(float(f["allocation"]), 2)) for f in funds),
           round(amount, 2), start.isoformat()[:7])
    hit = _memo.get(key)
    if hit and time.time() - hit[0] < _MEMO_TTL:
        return hit[1]

    total_w = sum(float(f["allocation"]) for f in funds) or 1.0
    codes = {int(f["scheme_code"]) for f in funds}
    for f in funds:
        for c, _ in SLEEVE_PROXIES.get((f.get("sleeve") or "other"), SLEEVE_PROXIES["other"]):
            codes.add(c)
    with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
        monthly = dict(zip(codes, ex.map(_monthly, codes)))

    rows = []
    for f in funds:
        sleeve = f.get("sleeve") or "other"
        chain = [(n, monthly.get(c, {})) for c, n in SLEEVE_PROXIES.get(sleeve, SLEEVE_PROXIES["other"])
                 if c != int(f["scheme_code"])]
        idx, used = _splice(monthly.get(int(f["scheme_code"]), {}), chain)
        if not idx:
            return {"ok": False, "detail": f"No NAV history for {f.get('name')}."}
        rows.append({"name": f.get("name") or "Fund", "sleeve": sleeve,
                     "weight": float(f["allocation"]) / total_w, "idx": idx, "proxy": used})

    common = set.intersection(*(set(r["idx"]) for r in rows))
    if not common:
        return {"ok": False, "detail": "The funds share no common history."}
    earliest, latest = min(common), max(common)
    want = start.isoformat()[:7]
    start_m = max(want, earliest)
    months = sorted(m for m in common if m >= start_m)
    if len(months) < 2:
        return {"ok": False, "detail": "Pick a purchase date at least a couple of months ago."}

    series = []
    for m in months:
        v = sum(amount * r["weight"] * r["idx"][m] / r["idx"][months[0]] for r in rows)
        series.append({"date": m, "value": round(v)})

    final = series[-1]["value"]
    y0, m0 = map(int, months[0].split("-"))
    today = date.today()
    years = max((today - date(y0, m0, 28)).days / 365.25, 1 / 12)
    cagr = ((final / amount) ** (1 / years) - 1) * 100 if amount > 0 and final > 0 else None

    out = {
        "ok": True,
        "amount": round(amount),
        "basket": "yours" if is_own else "standard",
        "start_requested": want,
        "start": months[0],
        "start_clamped": want < earliest,
        "earliest_available": earliest,
        "end": latest,
        "years": round(years, 2),
        "series": series,
        "final_value": final,
        "cagr_pct": round(cagr, 2) if cagr is not None else None,
        "funds": [{"name": r["name"], "sleeve": r["sleeve"], "weight": round(r["weight"] * 100, 1),
                   # only the stand-ins that actually cover part of THIS window
                   "proxy": [p for p in r["proxy"] if p["until"] > months[0]]} for r in rows],
    }
    _memo[key] = (time.time(), out)
    return out


def prewarm() -> None:
    """Fetch (and memoise) the full NAV history of every stand-in fund and the
    standard mix at boot, so the first calculator open doesn't wait on mfapi."""
    codes = {c for chain in SLEEVE_PROXIES.values() for c, _ in chain}
    codes |= {f["scheme_code"] for f in STANDARD_MIX}
    try:
        from app.client_portfolio import _villa_scheme_codes
        codes |= {int(c) for c in (_villa_scheme_codes() or []) if c}
    except Exception:
        pass
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(_monthly, codes))
