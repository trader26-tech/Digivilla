"""The calculators' public endpoints — the data and the settings every calculator
(FD / Lumpsum / SIP / Flat vs DigiVilla) runs on. The simulations themselves run
in the app (client/frontend/src/app/calc/engine) so the sliders stay instant.

    GET /calc/config        the calculator SETTINGS (app/calc_config.py)
    GET /calc/villa-funds   every benchmark series, month-end (app/index_data.py)

Public: the figures are illustrative history, not user data.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

router = APIRouter()


def index_basket_paths(start: Optional[str] = None) -> dict:
    """The calculators' data: every benchmark series (arbitrage, gold, large,
    mid, small) on its INDEX — never an active fund — weighted for the default
    villa. Every villa's mix, the SWP rates and the tax rules come from
    GET /calc/config (app/calc_config.py); the app re-weights locally."""
    from app import calc_config, index_data
    w = dict(calc_config.villa()["weights"])
    for s in calc_config.SERIES:          # every series, even at 0, so any villa can be drawn
        w.setdefault(s, 0.0)
    d = index_data.basket_paths(w)
    if d.get("ok") and start:
        months = [m for m in d["months"] if m >= start]
        if len(months) < 13:
            return {"ok": False, "detail": "Pick a purchase date at least a year ago."}
        i0 = d["months"].index(months[0])
        d = {**d, "start": months[0], "months": months,
             "funds": [{**f, "nav": f["nav"][i0:], "index": [round(v / f["nav"][i0], 6) for v in f["nav"][i0:]]}
                       for f in d["funds"]]}
    return d


@router.get("/calc/config")
def calc_settings() -> dict:
    """The calculator SETTINGS in force (villas, rebalancing, SWP, tax, estate) —
    the app, the admin and the research function all read this one object."""
    from app import calc_config
    return calc_config.get()


@router.get("/calc/villa-funds")
def villa_funds(start: Optional[str] = None) -> dict:
    """Month-end growth index (1.0 at `start`, 'YYYY-MM') per sleeve of the
    DigiVilla split, on the window every sleeve has history for — each sleeve on
    its benchmark index (Nifty Arbitrage / Midcap 150 TRI / Smallcap 250 TRI /
    domestic gold), not on an actively managed fund."""
    return index_basket_paths(start)
