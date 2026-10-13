"""Villas vs the market — the DAILY index levels behind the admin home chart.

The chart replays the three villas (their mixes come from the calculator
SETTINGS, calc_config.json) on the SAME benchmark indices the calculators use,
day by day, and lays a market index over them:

  parts of a villa                         benchmarks to compare with
    arbitrage  NIFTY 50 Arbitrage (price)    NIFTY 500 TRI (default)
    large      NIFTY 50 TRI                  NIFTY 50 TRI
    mid        NIFTY Midcap 150 TRI          NIFTY 100 TRI
    small      NIFTY Smallcap 250 TRI        NIFTY Next 50 TRI
    gold       Gold BeES (stitched ETF NAV)  NIFTY Midcap 150 TRI / Smallcap 250 TRI

Every index is a TOTAL RETURN index (dividends in) except the arbitrage index,
which is the price index the calculators use. Values are daily closes from
niftyindices.com (gold from AMFI via mfapi, the same stitching as the client's
app/index_data.py). The villas themselves are worked out in the browser from
these levels, so any start date gives a villa that starts on its target mix.

Where the numbers live, in order:
  1. this worker's memory,
  2. Supabase Storage  calc-data/index_daily.json  (written by every refresh),
  3. the snapshot in the repo  app/market_data/index_daily.json.
When the latest stored day is behind the last weekday, a background refresh
pulls the last ~45 days and merges them in (at most once an hour).
`python -m app.market --full` rebuilds everything from April 2010.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

START = date(2010, 4, 1)          # the arbitrage index starts here, so every villa can too

SERIES = [
    # villa parts
    {"key": "arbitrage", "name": "Nifty 50 Arbitrage", "nifty": "NIFTY 50 ARBITRAGE", "kind": "price"},
    {"key": "large", "name": "Nifty 50 TRI", "nifty": "NIFTY 50", "kind": "tri"},
    {"key": "mid", "name": "Nifty Midcap 150 TRI", "nifty": "NIFTY MIDCAP 150", "kind": "tri"},
    {"key": "small", "name": "Nifty Smallcap 250 TRI", "nifty": "NIFTY SMALLCAP 250", "kind": "tri"},
    {"key": "gold", "name": "Gold BeES", "mfapi": [105085, 115744, 140088]},
    # benchmarks only
    {"key": "n500", "name": "Nifty 500 TRI", "nifty": "NIFTY 500", "kind": "tri"},
    {"key": "n100", "name": "Nifty 100 TRI", "nifty": "NIFTY 100", "kind": "tri"},
    {"key": "next50", "name": "Nifty Next 50 TRI", "nifty": "NIFTY NEXT 50", "kind": "tri"},
]

# what the admin can compare against, in menu order (key → short label)
BENCHMARKS = [
    {"key": "n500", "label": "Nifty 500", "about": "India's 500 largest listed companies — the broad market"},
    {"key": "large", "label": "Nifty 50", "about": "The 50 largest companies"},
    {"key": "n100", "label": "Nifty 100", "about": "The 100 largest companies"},
    {"key": "next50", "label": "Nifty Next 50", "about": "Companies ranked 51–100"},
    {"key": "mid", "label": "Midcap 150", "about": "Companies ranked 101–250"},
    {"key": "small", "label": "Smallcap 250", "about": "Companies ranked 251–500"},
]

_SNAPSHOT = Path(__file__).resolve().parent / "market_data" / "index_daily.json"
_BUCKET, _OBJECT = "calc-data", "index_daily.json"
_MEM: dict = {"at": 0.0, "data": None}
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
        time.sleep(0.3)                                   # be gentle with the site
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
                old = _gold(s["mfapi"])                    # always the whole history: replace, never merge
            raw[s["key"]] = {d: v for d, v in old.items() if d >= START.isoformat()}
    finally:
        c.close()
    return _pack(raw)


def _as_dict(data: dict, key: str) -> dict[str, float]:
    vals = (data.get("series", {}).get(key) or {}).get("values") or []
    return {d: v for d, v in zip(data["days"], vals) if v is not None}


def _pack(raw: dict[str, dict[str, float]]) -> dict:
    """One shared calendar = the days the Nifty 50 traded; every other series is
    read on those days, carrying its last value over a gap (gold trades on a
    few days the index doesn't, and the other way round)."""
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


# ─────────────────────────────── storage ───────────────────────────────
def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


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


def save(data: dict, snapshot: bool = False) -> None:
    body = json.dumps(data, separators=(",", ":"))
    if snapshot:
        _SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        _SNAPSHOT.write_text(body)
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
    """The daily series (memory → storage → snapshot); kicks off a background
    refresh when they stop short of the last weekday (at most once an hour)."""
    with _LOCK:
        d = _MEM["data"]
        if d is None:
            d = _load_stored()
            _MEM["data"] = d
        stale = not d or d["days"][-1] < _last_weekday()
        if stale and time.time() - _MEM["at"] > 3600:
            _MEM["at"] = time.time()
            threading.Thread(target=_refresh_bg, daemon=True).start()
    return d or {"days": [], "series": {}}


def _refresh_bg() -> None:
    try:
        d = fetch(full=False)
        if d["days"] and all(any(v is not None for v in s["values"][-5:]) for s in d["series"].values()):
            save(d)
            with _LOCK:
                _MEM["data"] = d
    except Exception:
        pass


# ─────────────────────────────── the chart's payload ───────────────────────────────
_FIRST: dict = {"at": 0.0, "day": None}


def _first_investment() -> Optional[str]:
    """The earliest real client transaction (the demo account left out); memo 10 min."""
    if time.time() - _FIRST["at"] < 600:
        return _FIRST["day"]
    try:
        from app import reports as R
        rows = R._all_rows("client_transactions", "client_code,txn_date")
        ds = [str(r["txn_date"])[:10] for r in rows if r.get("txn_date") and r.get("client_code") != R.DEMO_CODE]
        _FIRST.update(at=time.time(), day=min(ds) if ds else None)
        return _FIRST["day"]
    except Exception:
        return None


def performance() -> dict:
    from app.calc_settings import calc_config
    cfg = calc_config.get()
    h = history()
    return {
        "as_of": h["days"][-1] if h.get("days") else None,
        "days": h.get("days", []),
        "series": h.get("series", {}),
        "villas": [{"key": v["key"], "name": v["name"], "risk_name": v.get("risk_name"), "weights": v["weights"]}
                   for v in cfg["villas"]],
        "default_villa": cfg.get("default_villa"),
        "rebalance": cfg.get("rebalance"),
        "benchmarks": BENCHMARKS,
        "first_investment": _first_investment(),
    }


# ─────────────────────────────── today, live ───────────────────────────────
# NSE's own index board: price indices, so today's % move (a TRI moves the same
# within a day, bar the odd dividend). No gold or arbitrage index there — those
# parts keep their last close until the evening NAV / index file.
_NSE_NAMES = {"NIFTY 500": "n500", "NIFTY 50": "large", "NIFTY 100": "n100", "NIFTY NEXT 50": "next50",
              "NIFTY MIDCAP 150": "mid", "NIFTY SMALLCAP 250": "small"}
_LIVE: dict = {"at": 0.0, "data": None}


def _nse_live() -> dict:
    c = httpx.Client(timeout=15, headers={**_UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9",
                                          "Referer": "https://www.nseindia.com/"}, follow_redirects=True)
    try:
        try:
            c.get("https://www.nseindia.com/")          # cookies (the page itself may refuse; the API usually doesn't)
        except Exception:
            pass
        d = c.get("https://www.nseindia.com/api/allIndices").json()
        try:
            st = next((m for m in c.get("https://www.nseindia.com/api/marketStatus").json().get("marketState", [])
                       if m.get("market") == "Capital Market"), {})
        except Exception:
            st = {}
    finally:
        c.close()
    quotes = {}
    for x in d.get("data") or []:
        k = _NSE_NAMES.get(x.get("index"))
        if k:
            quotes[k] = {"last": x.get("last"), "prev": x.get("previousClose"), "pct": x.get("percentChange"),
                         "adv": _int(x.get("advances")), "dec": _int(x.get("declines")),
                         "high": x.get("high"), "low": x.get("low")}
    stamp = d.get("timestamp") or st.get("tradeDate") or ""
    try:
        when = datetime.strptime(stamp.strip(), "%d-%b-%Y %H:%M")
    except ValueError:
        when = None
    return {
        "open": (st.get("marketStatus") or "").lower() == "open",
        "status": st.get("marketStatus") or "",
        "day": when.date().isoformat() if when else None,
        "time": when.strftime("%H:%M") if when else None,
        "quotes": quotes,
    }


def _int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def live() -> dict:
    """Today's moves (cached 60 s; on a failure the last good board is served, marked stale)."""
    with _LOCK:
        if _LIVE["data"] and time.time() - _LIVE["at"] < 60:
            return _LIVE["data"]
    try:
        d = _nse_live()
        if d["quotes"]:
            with _LOCK:
                _LIVE.update(at=time.time(), data=d)
            return d
    except Exception:
        pass
    with _LOCK:
        _LIVE["at"] = time.time() - 30                    # retry in ~30 s
        return {**(_LIVE["data"] or {"open": False, "status": "", "day": None, "time": None, "quotes": {}}), "stale": True}


if __name__ == "__main__":                       # python -m app.market [--full]
    import sys
    data = fetch(full="--full" in sys.argv)
    save(data, snapshot=True)
    print(f"{len(data['days'])} days, {data['days'][0]} → {data['days'][-1]}")
    for k, s in data["series"].items():
        first = next(i for i, v in enumerate(s["values"]) if v is not None)
        print(f"  {k:10s} from {data['days'][first]}  last {s['values'][-1]}")
