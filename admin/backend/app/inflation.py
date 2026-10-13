"""Inflation — consumer price indices for the "World markets" chart's REAL (after-inflation) view.

  US     FRED CPIAUCSL (all items, monthly, seasonally adjusted) — current to the last release
  India  FRED INDCPIALLMINMEI (OECD's copy of India's CPI, monthly) up to where it stops, then
         MOSPI's official All-India CPI (Combined, 2012 = 100), chained on at their last common
         month so the two read as one series

After the last published month each series is carried forward at its latest 12-month rate, so
"today" has a value; those months are flagged (`estimated_from`), never passed off as data.

Every series is a monthly level keyed by day number (days since 1970-01-01) of the 1st of the
month; the page treats a month's level as holding for every day of that month. Cached for a
day (prices are published monthly); the last good copy is served if a source is down.
"""

from __future__ import annotations

import csv
import io
import time
from datetime import date

import httpx

_UA = {"User-Agent": "Mozilla/5.0"}            # for MOSPI; FRED gets httpx's own UA — it stalls made-up ones (bot check)
_FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
_MOSPI = ("https://api.mospi.gov.in/api/cpi/getCPIIndex?base_year=2012&series=Current&year={y}"
          "&state_code=99&sector_code=3&group_code=0&page={p}&Format=JSON")
_MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July",
                                       "August", "September", "October", "November", "December"], 1)}
FROM_YEAR = 2000
_CACHE: dict = {}
_TTL = 24 * 3600


def _day(y: int, m: int) -> int:
    return (date(y, m, 1) - date(1970, 1, 1)).days


def _fred(series_id: str) -> dict[tuple[int, int], float]:
    r = httpx.get(_FRED.format(series_id), timeout=60, follow_redirects=True)
    r.raise_for_status()
    out = {}
    for row in csv.reader(io.StringIO(r.text)):
        if len(row) < 2 or not row[0][:4].isdigit():
            continue
        try:
            y, m = int(row[0][:4]), int(row[0][5:7])
            if y >= FROM_YEAR:
                out[(y, m)] = float(row[1])
        except ValueError:
            continue                                   # "." = no value that month
    return out


def _mospi(year: int) -> dict[tuple[int, int], float]:
    out = {}
    for page in (1, 2):                                # 10 months a page
        try:
            r = httpx.get(_MOSPI.format(y=year, p=page), headers=_UA, timeout=30)
            rows = (r.json() or {}).get("data") or []
        except Exception:
            break
        for x in rows:
            if x.get("state") == "All India" and x.get("month") in _MONTHS and x.get("index"):
                out[(year, _MONTHS[x["month"]])] = float(x["index"])
        if len(rows) < 10:
            break
    return out


def _chain(base: dict, ext: dict) -> dict:
    """Append `ext`'s later months to `base`, rescaled at their last common month."""
    common = sorted(set(base) & set(ext))
    if not common:
        return base
    k = common[-1]
    f = base[k] / ext[k]
    out = dict(base)
    for ym, v in ext.items():
        if ym > k:
            out[ym] = v * f
    return out


def _series(levels: dict, name: str, source: str) -> dict:
    """Monthly levels → {d, v} through the current month, carrying the last 12-month rate forward."""
    keys = sorted(levels)
    last = keys[-1]
    y, m = last
    prev = levels.get((y - 1, m))
    monthly = (levels[last] / prev) ** (1 / 12) if prev else 1.0
    yoy = (levels[last] / prev - 1) * 100 if prev else None
    t = date.today()
    v = levels[last]
    est_from = None
    while (y, m) < (t.year, t.month):
        m += 1
        if m > 12:
            y, m = y + 1, 1
        v *= monthly
        levels[(y, m)] = v
        est_from = est_from or _day(y, m)
    keys = sorted(levels)
    return {"name": name, "source": source,
            "d": [_day(*k) for k in keys], "v": [round(levels[k], 4) for k in keys],
            "last_actual": _day(*last), "latest_yoy": round(yoy, 2) if yoy is not None else None,
            "estimated_from": est_from}


def _load() -> dict:
    us = _fred("CPIAUCSL")
    india = _fred("INDCPIALLMINMEI")
    last_y = max(y for y, _ in india) if india else FROM_YEAR
    for y in range(last_y, date.today().year + 1):     # MOSPI picks up where OECD's copy stops
        try:
            india = _chain(india, _mospi(y))
        except Exception:
            pass
    return {
        "US": _series(us, "US inflation (CPI)", "US Bureau of Labor Statistics via FRED"),
        "IN": _series(india, "India inflation (CPI)", "MOSPI All-India CPI (Combined), earlier years via OECD/FRED"),
    }


def cpi() -> dict:
    hit = _CACHE.get("cpi")
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    try:
        val = _load()
    except Exception:
        if hit:
            return hit[1]                              # a source is down: keep the last good copy
        raise
    _CACHE["cpi"] = (time.time(), val)
    return val
