"""Flat calculator — per-fund month-end growth paths for the standard villa mix.

The flat calculator (client/frontend/src/app/calc/flat-calc.component.ts) asks:
"if the money that went into my flat had gone into the DigiVilla bucket instead,
paying me the SAME in-hand rent every month, where would I be today?"

To answer that the client needs each sleeve of the villa mix separately — the
rent is drawn only from the arbitrage sleeve, and the calculator re-sizes that
sleeve to the flat's rent (the rest goes to the growth sleeves). So this returns
one growth index per sleeve (1.0 at `start`) on the common month window, and the
simulation itself runs client-side so the sliders stay instant.

Fund list, proxy chains and the NAV memo are shared with the land calculator
(app.calculators) so both calculators describe the same bucket.

Public: the figures are illustrative history, not user data.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import APIRouter

from app.calculators import SLEEVE_PROXIES, _monthly, _splice, plan_type, villa_mix

router = APIRouter()

_memo: dict = {}
_MEMO_TTL = 3600


def _sleeve_indices() -> Optional[list[dict]]:
    """Each standard-mix fund's month-end NAV, extended back with its sleeve's
    proxies. Memoised per worker — history only moves once a day."""
    mix = villa_mix()
    sig = tuple((int(f["scheme_code"]), f["allocation"]) for f in mix)
    hit = _memo.get("rows")
    if hit and hit[2] == sig and time.time() - hit[0] < _MEMO_TTL:
        return hit[1]
    codes = {int(f["scheme_code"]) for f in mix}
    for f in mix:
        codes.update(c for c, _ in SLEEVE_PROXIES[f["sleeve"]])
    with ThreadPoolExecutor(max_workers=min(8, len(codes))) as ex:
        monthly = dict(zip(codes, ex.map(_monthly, codes)))
        plans = dict(zip([int(f["scheme_code"]) for f in mix], ex.map(plan_type, [int(f["scheme_code"]) for f in mix])))

    rows = []
    for f in mix:
        chain = [(n, monthly.get(c, {})) for c, n in SLEEVE_PROXIES[f["sleeve"]]
                 if c != int(f["scheme_code"])]
        idx, used = _splice(monthly.get(int(f["scheme_code"]), {}), chain)
        if not idx:
            return hit[1] if hit else None  # keep the last good copy through an mfapi blip
        rows.append({"name": f["name"], "sleeve": f["sleeve"], "code": int(f["scheme_code"]), "plan": plans[int(f["scheme_code"])],
                     "weight": f["allocation"] / 100.0, "idx": idx, "proxy": used})
    _memo["rows"] = (time.time(), rows, sig)
    return rows


def villa_fund_paths(start: Optional[str] = None) -> dict:
    rows = _sleeve_indices()
    if not rows:
        return {"ok": False, "detail": "Fund history is unavailable right now."}

    common = sorted(set.intersection(*(set(r["idx"]) for r in rows)))
    earliest = common[0]
    note = None
    if start and start < earliest:
        note = f"Fund history for the villa mix starts {earliest}; the comparison runs from then."
    months = [m for m in common if m >= (start or earliest)]
    if len(months) < 13:
        return {"ok": False, "detail": "Pick a purchase date at least a year ago."}

    funds = []
    for r in rows:
        base = r["idx"][months[0]]
        funds.append({
            "sleeve": r["sleeve"],
            "name": r["name"],
            "weight": r["weight"],
            "proxy": [p for p in r["proxy"] if p["until"] > months[0]],
            "plan": r["plan"],
            "index": [round(r["idx"][m] / base, 6) for m in months],
            # month-end NAV (₹ per unit); before a fund launched, its stand-in's
            # returns scaled onto the fund's first NAV (see "proxy")
            "nav": [round(r["idx"][m], 4) for m in months],
        })

    return {
        "ok": True,
        "start": months[0],
        "end": months[-1],
        "earliest": earliest,
        "months": months,
        "funds": funds,
        "note": note,
    }


def index_basket_paths(start: Optional[str] = None) -> dict:
    """The calculators' basket: today's DigiVilla split BY SLEEVE (from the admin's
    villa bucket), each sleeve on its benchmark INDEX — never an active fund.
    See app/index_data.py for the series and sources."""
    from app import index_data
    weights: dict[str, float] = {}
    for f in villa_mix():
        weights[f["sleeve"]] = weights.get(f["sleeve"], 0) + float(f["allocation"])
    covered = {s["sleeve"] for s in index_data.SERIES}
    tot = sum(w for k, w in weights.items() if k in covered) or 1.0
    d = index_data.basket_paths({k: w / tot for k, w in weights.items() if k in covered})
    if d.get("ok") and start:
        months = [m for m in d["months"] if m >= start]
        if len(months) < 13:
            return {"ok": False, "detail": "Pick a purchase date at least a year ago."}
        i0 = d["months"].index(months[0])
        d = {**d, "start": months[0], "months": months,
             "funds": [{**f, "nav": f["nav"][i0:], "index": [round(v / f["nav"][i0], 6) for v in f["nav"][i0:]]}
                       for f in d["funds"]]}
    return d


@router.get("/calc/villa-funds")
def villa_funds(start: Optional[str] = None) -> dict:
    """Month-end growth index (1.0 at `start`, 'YYYY-MM') per sleeve of the
    DigiVilla split, on the window every sleeve has history for — each sleeve on
    its benchmark index (Nifty Arbitrage / Midcap 150 TRI / Smallcap 250 TRI /
    domestic gold), not on an actively managed fund."""
    return index_basket_paths(start)
