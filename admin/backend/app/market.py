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
    {"key": "lms_eq", "label": "Equal L·M·S",
     "about": "Large, mid and small cap equally — ⅓ Nifty 100 + ⅓ Midcap 150 + ⅓ Smallcap 250 TRI, back to ⅓ each every 1 Jan"},
]

# benchmarks built here from the stored indices: key → {part: weight}. Each is
# rebalanced to its weights at every December close, like a villa's growth part.
BLENDS = {"lms_eq": {"n100": 1 / 3, "mid": 1 / 3, "small": 1 / 3}}


def _blend(days: list[str], series: dict, weights: dict[str, float]) -> tuple[list, dict[str, float]]:
    """A blend's daily level (100 on the first day every part has a close; null
    before), and its parts' weights on the last day — for today's live move."""
    parts = list(weights)
    cols = [(series.get(p) or {}).get("values") or [] for p in parts]
    out: list = []
    units: Optional[list[float]] = None
    level = 100.0
    for i, d in enumerate(days):
        px = [c[i] if i < len(c) else None for c in cols]
        if units is None:
            if any(v is None or v <= 0 for v in px):
                out.append(None)
                continue
            units = [level * weights[p] / v for p, v in zip(parts, px)]
        else:
            px = [v if v is not None else 0 for v in px]
            level = sum(u * v for u, v in zip(units, px))
        out.append(round(level, 4))
        if i + 1 < len(days) and days[i + 1][:4] != d[:4]:          # December close → back to the weights
            units = [level * weights[p] / v if v else 0 for p, v in zip(parts, px)]
    last = [c[-1] if c else None for c in cols]
    vals = [u * (v or 0) for u, v in zip(units or [0] * len(parts), last)]
    tot = sum(vals) or 1
    return out, {p: v / tot for p, v in zip(parts, vals)}


def _with_blends(days: list[str], series: dict) -> tuple[dict, dict[str, dict[str, float]]]:
    out, drift = dict(series), {}
    for key, w in BLENDS.items():
        vals, drift[key] = _blend(days, series, w)
        out[key] = {"name": next(b["label"] for b in BENCHMARKS if b["key"] == key), "values": vals}
    return out, drift

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


# ─────────────────────────────── the actual funds ───────────────────────────────
# The villa lines are built from INDICES (a clean, cost-free replica). The admin can
# also see the ACTUAL funds in each villa bucket — their published NAVs, day by day —
# and build the villas from those instead. NAV histories come from mfapi, fetched
# concurrently and kept 6 h per worker.
_FUND_HIST: dict[int, tuple[float, dict[str, float]]] = {}
_FUNDS_TTL = 6 * 3600
_FB: dict = {"at": 0.0, "days": None, "block": None}


def _short(name: str) -> str:
    import re
    s = re.sub(r"\s*-\s*(Direct|Regular)?\s*(Plan)?\s*-?\s*(Growth|IDCW|Dividend).*$", "", name or "", flags=re.I)
    s = re.sub(r"\s+(Growth|Gr)$", "", s, flags=re.I)
    s = re.sub(r"\s+Fund$", "", s.strip(), flags=re.I).strip()
    if s and s == s.upper():
        s = " ".join(w if w in ("ETF", "FOF", "SBI", "HDFC", "ICICI", "UTI", "DSP", "LIC", "PGIM", "HSBC") else w.capitalize() for w in s.split())
    return s or (name or "Fund")


def _fund_hist(code: int) -> dict[str, float]:
    """{YYYY-MM-DD: nav} for one scheme (mfapi), memo 6 h; an empty dict on failure (retried next time)."""
    hit = _FUND_HIST.get(code)
    if hit and time.time() - hit[0] < _FUNDS_TTL:
        return hit[1]
    out: dict[str, float] = {}
    try:
        d = httpx.get(f"https://api.mfapi.in/mf/{code}", timeout=40).json()
        for p in d.get("data") or []:
            try:
                nav = float(p["nav"])
            except (TypeError, ValueError):
                continue
            if nav > 0:
                dd, mm, yy = p["date"].split("-")
                out[f"{yy}-{mm}-{dd}"] = nav
    except Exception:
        out = {}
    if out:
        _FUND_HIST[code] = (time.time(), out)
    return out


def _bucket_funds() -> tuple[list[dict], list[dict]]:
    try:
        from app import reports as R
        return (R._all_rows("villa_buckets", "id,name,kind"),
                R._all_rows("villa_bucket_funds", "bucket_id,scheme_code,scheme_name,sleeve,target_weight"))
    except Exception:
        return [], []


def funds_block(days: list[str], villas: list[dict]) -> dict:
    """{funds: [...], villa_funds: {villa_key: {sleeve: [{scheme_code, weight}]}}}.

    funds       every distinct fund in any villa bucket, its NAV on each of `days`
                (null before its first NAV, carried over a gap after), plus the
                sleeve it plays and which villas hold it
    villa_funds each villa's ACTUAL composition — the funds of the SIP bucket
                named after it, grouped by sleeve, weights normalised per sleeve"""
    if _FB["block"] is not None and _FB["days"] == len(days) and time.time() - _FB["at"] < _FUNDS_TTL:
        return _FB["block"]
    buckets, rows = _bucket_funds()
    bname = {b["id"]: ((b.get("name") or ""), (b.get("kind") or "sip")) for b in buckets}
    # which villa each bucket stands for: "Balanced Digi Villa" / "Lumpsum - Balanced" → balanced
    def villa_of(bucket_id):
        name = bname.get(bucket_id, ("", ""))[0].lower()
        for v in villas:
            if v["name"].lower() in name or v["key"].lower() in name:
                return v["key"]
        return None
    funds: dict[int, dict] = {}
    villa_funds: dict[str, dict[str, list]] = {}
    for r in rows:
        code = r.get("scheme_code")
        if not code:
            continue
        code = int(code)
        vk = villa_of(r.get("bucket_id"))
        kind = bname.get(r.get("bucket_id"), ("", "sip"))[1]
        sleeve = (r.get("sleeve") or "other").lower()
        f = funds.setdefault(code, {"key": f"fund:{code}", "scheme_code": code, "name": r.get("scheme_name") or "Fund",
                                    "short": _short(r.get("scheme_name") or ""), "sleeve": sleeve, "villas": []})
        if vk and vk not in f["villas"]:
            f["villas"].append(vk)
        # the SIP bucket defines the villa's actual mix (the lumpsum bucket is the same mix for one-off money)
        if vk and kind == "sip":
            lst = villa_funds.setdefault(vk, {}).setdefault(sleeve, [])
            if not any(x["scheme_code"] == code for x in lst):
                lst.append({"scheme_code": code, "weight": float(r.get("target_weight") or 0)})
    for vk in list(villa_funds):
        for sl, lst in villa_funds[vk].items():
            tot = sum(x["weight"] for x in lst) or len(lst)
            for x in lst:
                x["weight"] = round((x["weight"] or 1.0) / tot, 6)
    # NAV histories, concurrently
    from concurrent.futures import ThreadPoolExecutor
    codes = list(funds)
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(codes)))) as ex:
        hists = dict(zip(codes, ex.map(_fund_hist, codes)))
    out_funds = []
    for code in codes:
        hist = hists.get(code) or {}
        keys = sorted(hist)
        vals, j, last = [], 0, None
        for d in days:
            while j < len(keys) and keys[j] <= d:
                last = hist[keys[j]]
                j += 1
            vals.append(None if last is None else round(last, 4))
        f = dict(funds[code])
        f["values"] = vals
        f["since"] = keys[0] if keys else None
        f["ok"] = bool(keys)
        out_funds.append(f)
    order = {"arbitrage": 0, "gold": 1, "large": 2, "mid": 3, "small": 4}
    out_funds.sort(key=lambda f: (order.get(f["sleeve"], 9), f["short"]))
    block = {"funds": out_funds, "villa_funds": villa_funds}
    if all(f["ok"] for f in out_funds):
        _FB.update(at=time.time(), days=len(days), block=block)
    return block


def performance() -> dict:
    from app.calc_settings import calc_config
    cfg = calc_config.get()
    h = history()
    villas = [{"key": v["key"], "name": v["name"], "risk_name": v.get("risk_name"), "weights": v["weights"]}
              for v in cfg["villas"]]
    days = h.get("days", [])
    try:
        fb = funds_block(days, villas)
    except Exception:
        fb = {"funds": [], "villa_funds": {}}
    return {
        "as_of": days[-1] if days else None,
        "days": days,
        "series": _with_blends(days, h.get("series", {}))[0],
        "villas": villas,
        "default_villa": cfg.get("default_villa"),
        "rebalance": cfg.get("rebalance"),
        "benchmarks": BENCHMARKS,
        "first_investment": _first_investment(),
        # the villa lines are built from the indices above; these are the ACTUAL funds
        "funds": fb["funds"],
        "villa_funds": fb["villa_funds"],
        "sources": {"index": "Built from the indices (Nifty 50 Arbitrage, Nifty 50 / Midcap 150 / Smallcap 250 TRI, Gold BeES) — before fund costs",
                    "funds": "Built from the actual funds in each villa bucket, at their published NAVs — after fund costs"},
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


def _blend_quotes(quotes: dict) -> None:
    """Today's move of each blend = its parts' live moves, weighted as the blend stands now."""
    try:
        h = history()
        drift = _with_blends(h.get("days", []), h.get("series", {}))[1]
    except Exception:
        return
    for key, w in drift.items():
        if all(quotes.get(p, {}).get("pct") is not None for p in w):
            quotes[key] = {"last": None, "prev": None, "pct": round(sum(quotes[p]["pct"] * x for p, x in w.items()), 4),
                           "adv": None, "dec": None, "high": None, "low": None}


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
        _blend_quotes(d["quotes"])
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
