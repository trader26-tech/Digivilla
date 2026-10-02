"""The admin's INDEPENDENT calculator check — a Python twin of the app's engine
(client/frontend/src/app/calc/engine), driven by the same settings.

    settings.py   the settings in force (shared calc_config module)
    data.py       the history + villa weights + the "Data used" tab
    tax.py        financial years, tax rules, IRR
    book.py       lots, payouts, the yearly rebalance
    report.py     month-by-month detail, the story, rebalance rows
    checks.py     payout_check (FD / Lumpsum), sip_check, flat_check
"""

from app.calc_check.checks import flat_check, payout_check, sip_check
from app.calc_check.data import data_used, villa_funds
from app.calc_check.settings import _cfg

__all__ = ["payout_check", "sip_check", "flat_check", "data_used", "villa_funds", "_cfg"]
