"""Daily index levels for the client app — the SAME store the admin's "Villas
vs market" page keeps (Supabase Storage `calc-data/index_daily.json`), read
here so a client can see each fund against its own index, day by day.

Series (one shared calendar = the days the Nifty 50 traded, since 2010-04-01):
  arbitrage  Nifty 50 Arbitrage (price)      ← arbitrage funds
  large      Nifty 50 TRI                    ← large-cap funds
  mid        Nifty Midcap 150 TRI            ← mid-cap funds
  small      Nifty Smallcap 250 TRI          ← small-cap funds
  gold       Gold BeES (stitched NAV)        ← gold funds / FoFs
  n500       Nifty 500 TRI                   ← multi / flexi / hybrid / other
  n100, next50                               (benchmarks only)

Reading: memory → storage → the repo snapshot. When the stored days stop short
of the last weekday, a background refresh pulls the last ~45 days from
niftyindices.com / mfapi (the admin does the same; both write the same object,
so whichever runs first wins and the other finds it fresh). Never on the
request path.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

START = date(2010, 4, 1)

SERIES = [
    {"key": "arbitrage", "name": "Nifty 50 Arbitrage", "nifty": "NIFTY 50 ARBITRAGE", "kind": "price"},
    {"key": "large", "name": "Nifty 50 TRI", "nifty": "NIFTY 50", "kind": "tri"},
    {"key": "mid", "name": "Nifty Midcap 150 TRI", "nifty": "NIFTY MIDCAP 150", "kind": "tri"},
    {"key": "small", "name": "Nifty Smallcap 250 TRI", "nifty": "NIFTY SMALLCAP 250", "kind": "tri"},
    {"key": "gold", "name": "Gold BeES", "mfapi": [105085, 115744, 140088]},
    {"key": "n500", "name": "Nifty 500 TRI", "nifty": "NIFTY 500", "kind": "tri"},
    {"key": "n100", "name": "Nifty 100 TRI", "nifty": "NIFTY 100", "kind": "tri"},
    {"key": "next50", "name": "Nifty Next 50 TRI", "nifty": "NIFTY NEXT 50", "kind": "tri"},
]
NAMES = {s["key"]: s["name"] for s in SERIES}
SHORT = {"arbitrage": "Nifty 50 Arbitrage", "large": "Nifty 50", "mid": "Nifty Midcap 150",
         "small": "Nifty Smallcap 250", "gold": "Gold", "n500": "Nifty 500", "n100": "Nifty 100", "next50": "Nifty Next 50"}

# which index a fund is measured against, by its sleeve (see client_portfolio._holding_sleeve)
BENCH_BY_SLEEVE = {"arbitrage": "arbitrage", "large": "large", "mid": "mid", "small": "small", "gold": "gold",
                   "multi": "n500", "hybrid": "n500", "other": "n500", "debt": None}

_SNAPSHOT = Path(__file__).resolve().parent / "data" / "index_daily.json"
_BUCKET, _OBJECT = "calc-data", "index_daily.json"
_MEM: dict = {"at": 0.0, "data": None, "loaded_at": 0.0}
_LOCK = threading.Lock()
_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124 Safari/537.36"}


# ─────────────────────────────── sources ───────────────────────────────
def _nifty_session() -> httpx.Client:
    c = httpx.Client(timeout=60, headers=_UA, follow_redirects=True)
    c.get("https://www.niftyindices.com/reports/historical-data")   # sets the session cookies
    return c


def _nifty(c: httpx.Client, s: dict, first: date, last: date) -> dict[str, float]:
    """{day: close} from niftyindices.com, one ≤1-year window per call (the site's limit)."""
    ep = "getTotalReturnIndexString" if s["kind"] == "tri" else "getHistoricaldatatabletoString"
    out: dict[str, float] = {}
    for y in range(first.year, last.year + 1):
        a, b = max(first, date(y, 1, 1)), min(last, date(y, 12, 31))
        if a > b:
            continue
        cinfo = "{'name':'%s','startDate':'%s','endDate':'%s','indexName':'%s'}" % (
            s["nifty"], a.strftime("%d-%b-%Y"), b.strftime("%d-%b-%Y"), s["nifty"])
        r = c.post(f"https://www.niftyindices.com/BackPage/{ep}", json={"cinfo": cinfo},
                   headers={"X-Requested-With": "XMLHttpRequest", "Origin": "https://www.niftyindices.com",
                            "Referer": "https://www.niftyindices.com/reports/historical-data"})
        rows = r.json() or []
        if isinstance(rows, dict):
            rows = json.loads(rows.get("d") or "[]")
        for row in rows:
            d = row.get("Date") or row.get("HistoricalDate")
            v = row.get("TotalReturnsIndex") if s["kind"] == "tri" else row.get("CLOSE")
            try:
                out[datetime.strptime(d.strip(), "%d %b %Y").date().isoformat()] = float(str(v).replace(",", ""))
            except (TypeError, ValueError, AttributeError):
                continue
        time.sleep(0.3)
    return out


def _gold(codes: list[int]) -> dict[str, float]:
    """Gold BeES NAV per day, one ETF stitched across its AMFI codes, unit splits
    scaled out (walking back from today so the latest NAVs keep their level)."""
    by_day: dict[str, float] = {}
    for code in codes:
        d = httpx.get(f"https://api.mfapi.in/mf/{code}", timeout=60).json()
        for p in d.get("data") or []:
            try:
                nav = float(p["nav"])
            except (TypeError, ValueError):
                continue
            if nav > 0:
                dd, mm, yy = p["date"].split("-")
                by_day[f"{yy}-{mm}-{dd}"] = nav
    factor, out, prev = 1.0, {}, None
    for day, nav in reversed(sorted(by_day.items())):
        if prev is not None and nav / prev > 5:
            factor *= round(nav / prev)
        out[day] = nav / factor
        prev = nav
    return out


def _as_dict(data: dict, key: str) -> dict[str, float]:
    vals = (data.get("series", {}).get(key) or {}).get("values") or []
    return {d: v for d, v in zip(data["days"], vals) if v is not None}


def _pack(raw: dict[str, dict[str, float]]) -> dict:
    """One shared calendar = the days the Nifty 50 traded; every other series is
    read on those days, carrying its last value over a gap."""
    days = sorted(raw["large"])
    series = {}
    for s in SERIES:
        src = raw.get(s["key"]) or {}
        keys = sorted(src)
        vals, j, last = [], 0, None
        for d in days:
            while j < len(keys) and keys[j] <= d:
                last = src[keys[j]]
                j += 1
            vals.append(None if last is None else round(last, 4))
        series[s["key"]] = {"name": s["name"], "values": vals}
    return {"as_of": date.today().isoformat(), "days": days, "series": series}


def fetch(full: bool = False) -> dict:
    """Pull every series. full=True rebuilds from START; otherwise the last ~45
    days are fetched and merged into what is stored."""
    base = None if full else _load_stored()
    today = date.today()
    first = START if full or not base else today - timedelta(days=45)
    raw: dict[str, dict[str, float]] = {}
    c = _nifty_session()
    try:
        for s in SERIES:
            old = _as_dict(base, s["key"]) if base else {}
            if "nifty" in s:
                old.update(_nifty(c, s, first, today))
            else:
                old = _gold(s["mfapi"])
            raw[s["key"]] = {d: v for d, v in old.items() if d >= START.isoformat()}
    finally:
        c.close()
    return _pack(raw)


# ─────────────────────────────── storage ───────────────────────────────
def _sb():
    from app.client_portfolio import _sb as sb
    return sb()


def _load_stored() -> Optional[dict]:
    try:
        u = _sb().storage.from_(_BUCKET).create_signed_url(_OBJECT, 60)   # fresh link: no stale CDN copy
        r = httpx.get(u.get("signedURL") or u.get("signedUrl"), timeout=30)
        r.raise_for_status()
        d = r.json()
        if d.get("days"):
            return d
    except Exception:
        pass
    try:
        return json.loads(_SNAPSHOT.read_text())
    except Exception:
        return None


def save(data: dict) -> None:
    body = json.dumps(data, separators=(",", ":"))
    try:
        st = _sb().storage
        try:
            st.create_bucket(_BUCKET, options={"public": False})
        except Exception:
            pass
        st.from_(_BUCKET).upload(_OBJECT, body.encode(),
                                 {"content-type": "application/json", "upsert": "true", "cache-control": "0"})
    except Exception:
        pass


def _last_weekday() -> str:
    d = date.today() - timedelta(days=1)          # today's close may not be out yet
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def history() -> dict:
    """The daily series (memory → storage → snapshot). Re-reads storage every
    30 min (the admin may have refreshed it) and, when the days still stop
    short of the last weekday, refreshes in the background at most hourly."""
    with _LOCK:
        d = _MEM["data"]
        now = time.time()
        if d is None or now - _MEM["loaded_at"] > 1800:
            fresh = _load_stored()
            if fresh and (d is None or fresh["days"][-1] >= d["days"][-1]):
                d = fresh
            _MEM["data"], _MEM["loaded_at"] = d, now
        stale = not d or d["days"][-1] < _last_weekday()
        if stale and now - _MEM["at"] > 3600:
            _MEM["at"] = now
            threading.Thread(target=_refresh_bg, daemon=True, name="index-daily-refresh").start()
    return d or {"days": [], "series": {}}


def _refresh_bg() -> None:
    try:
        d = fetch(full=False)
        if d["days"] and all(any(v is not None for v in s["values"][-5:]) for s in d["series"].values()):
            save(d)
            with _LOCK:
                _MEM["data"], _MEM["loaded_at"] = d, time.time()
    except Exception:
        pass


def series(key: str) -> tuple[list[str], list[Optional[float]]]:
    """(days, values) for one index key — the shared calendar and that series."""
    d = history()
    vals = (d.get("series", {}).get(key) or {}).get("values") or []
    return d.get("days", []), vals
