"""Regression: tonight's NAV (in the live cache) must reach the comparison data the moment it lands —
the history mirror lags a day, and a row with a '23-10-2026' date must never push a bogus day in."""
from types import SimpleNamespace

from app import fund_moves as FM


class _P(SimpleNamespace):
    pass


def test_live_nav_lands_in_days_and_series(monkeypatch):
    days_hist = ["2026-10-21", "2026-10-22", "2026-10-23"]
    store = {"days": days_hist, "series": {"large": {"name": "Nifty 50 TRI", "values": [100.0, 101.0, 102.0]}}}
    hs = [{"scheme_code": 1, "scheme_name": "Fund A", "units": 10, "current_value": 1000, "invested": 900,
           "nav": 104.0, "nav_date": "2026-10-26", "prev_nav": 102.0, "prev_date": "2026-10-23", "day_change": 20.0},
          {"scheme_code": 2, "scheme_name": "Fund B", "units": 5, "current_value": 500, "invested": 450,
           "nav": 50.0, "nav_date": "23-10-2026", "prev_nav": 49.0, "prev_date": "22-10-2026", "day_change": 5.0}]
    navfull = {1: [_P(date=d, nav=v) for d, v in zip(days_hist, [100.0, 101.0, 102.0])],
               2: [_P(date=d, nav=v) for d, v in zip(days_hist, [48.0, 49.0, 50.0])]}
    monkeypatch.setattr(FM.cp, "_valued_holdings", lambda code: hs)
    monkeypatch.setattr(FM.cp, "_day_summary", lambda hs_: {"nav_date": "2026-10-26", "prev_date": "2026-10-23", "change": 25.0, "pct": 1.7})
    monkeypatch.setattr(FM.market_daily, "history", lambda: store)
    monkeypatch.setattr(FM.cp, "_nav_full_map", lambda rows: navfull)
    monkeypatch.setattr(FM.cp, "_holding_sleeve", lambda code, name: "large")
    monkeypatch.setattr(FM, "_txns", lambda code: [])
    monkeypatch.setattr(FM, "_since_by_scheme", lambda txns: {})
    monkeypatch.setattr(FM, "_portfolio_series", lambda txns, days, navmaps: {"from": 0, "invested": [0] * len(days), "value": [0] * len(days)})
    monkeypatch.setattr(FM.market_daily, "BENCH_BY_SLEEVE", {"large": "large"})
    monkeypatch.setattr(FM.market_daily, "SHORT", {"large": "Nifty 50"})

    m = FM._build("X")
    assert m["days"][-1] == "2026-10-26"                         # tonight's NAV day is on the calendar
    assert all(d.startswith("20") for d in m["days"])             # and no 'dd-mm-yyyy' day sneaked in
    a = next(f for f in m["funds"] if f["scheme_code"] == 1)
    assert a["nav_series"][-1] == 104.0 and a["nav_date"] == "2026-10-26"
    b = next(f for f in m["funds"] if f["scheme_code"] == 2)
    assert b["nav_date"] == "2026-10-23" and b["prev_date"] == "2026-10-22"   # normalised to ISO
    assert m["indices"][0]["key"] == "large" and len(m["indices"][0]["series"]) == len(m["days"])


def test_iso():
    assert FM._iso("2026-10-26") == "2026-10-26"
    assert FM._iso("23-10-2026") == "2026-10-23"
    assert FM._iso("") is None and FM._iso(None) is None and FM._iso("Oct 23") is None
