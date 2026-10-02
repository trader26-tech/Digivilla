"""The calculator SETTINGS, as the admin's checks read them (the same object the
app uses — see app/calc_settings.py)."""

from __future__ import annotations

from app.calc_settings import calc_config


def _cfg() -> dict:
    """The calculator SETTINGS in force — the same object the app uses."""
    return calc_config.get()

def _villa_unit() -> float: return float(_cfg()["estate"]["villa_cost"])

def _finished_at() -> float: return _villa_unit() * 0.99      # a lumpsum buys ~₹4,99,975 after stamp duty

def _villa_income() -> float: return float(_cfg()["estate"]["villa_income_monthly"])

def _max_houses() -> int: return int(_cfg()["estate"]["plots"])
