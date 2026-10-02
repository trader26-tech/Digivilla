"""The calculators' benchmark data — INDICES ONLY, no actively managed funds.

The calculators (FD / Flat / SIP / Lumpsum vs DigiVilla) replay the three
DigiVilla villas (PORTFOLIOS below) on the BENCHMARK each part tracks, never on
an active fund:

    arbitrage  → NIFTY 50 Arbitrage Index              (niftyindices.com, from Apr 2010)
    large cap  → NIFTY 50 TRI (total return)           (niftyindices.com, from Apr 2005)
    mid cap    → NIFTY Midcap 150 TRI (total return)   (niftyindices.com, from Apr 2005)
    small cap  → NIFTY Smallcap 250 TRI (total return) (niftyindices.com, from Apr 2005)
    gold       → Gold BeES (Nippon India ETF Gold BeES) NAV — there is no Nifty
                 gold index. One ETF, three AMFI codes as its fund house changed:
                 105085 Benchmark (Mar 2007 → Aug 2011) → 115744 Goldman Sachs
                 (→ Nov 2016) → 140088 Nippon India (→ today); unit splits are
                 scaled out so the series is continuous at today's level

Values are month-end closes keyed 'YYYY-MM'. They are index levels, so they are
BEFORE any fund's expense ratio (the explainer says so).

Where the numbers live, in order:
  1. this worker's memory (refreshed at most every 6 hours),
  2. Supabase Storage  calc-data/index_history.json  (written by every refresh),
  3. the snapshot in the repo  app/data/index_history.json  (always works).
A refresh pulls the last ~13 months from the sources and merges them in, so the
series always end at the latest month-end; `scripts/refresh_index_history.py
--full` rebuilds everything back to 2005.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import httpx

SERIES = [
    {"key": "arbitrage", "sleeve": "arbitrage", "name": "NIFTY 50 Arbitrage Index",
     "source": "niftyindices.com · index close", "nifty": "NIFTY 50 ARBITRAGE", "kind": "price", "from": 2010},
    {"key": "large", "sleeve": "large", "name": "NIFTY 50 TRI",
     "source": "niftyindices.com · total return index", "nifty": "NIFTY 50", "kind": "tri", "from": 2005},
    {"key": "mid", "sleeve": "mid", "name": "NIFTY Midcap 150 TRI",
     "source": "niftyindices.com · total return index", "nifty": "NIFTY MIDCAP 150", "kind": "tri", "from": 2005},
    {"key": "small", "sleeve": "small", "name": "NIFTY Smallcap 250 TRI",
     "source": "niftyindices.com · total return index", "nifty": "NIFTY SMALLCAP 250", "kind": "tri", "from": 2005},
    {"key": "gold", "sleeve": "gold", "name": "Gold BeES (Nippon India ETF Gold BeES)",
     "source": "AMFI / mfapi · schemes 105085 → 115744 → 140088 (same ETF across fund-house changes), split-adjusted",
     "mfapi": [105085, 115744, 140088], "from": 2007},
]

# The three villas. quadrant = gold / large / mid / small in equal parts (25% each
# of the quadrant), put back to 25% each every 1 January; the rest is arbitrage,
# never rebalanced, which pays the monthly income first. One source of truth:
# the client's backtest.model.ts and the admin's audit.py mirror these numbers.
QUADRANT = ("gold", "large", "mid", "small")
PORTFOLIOS = [
    {"key": "conservative", "name": "Conservative", "quadrant": 0.30, "arbitrage": 0.70, "risk": 1, "risk_name": "Low"},
    {"key": "balanced", "name": "Balanced", "quadrant": 0.64, "arbitrage": 0.36, "risk": 2, "risk_name": "Medium"},
    {"key": "aggressive", "name": "Aggressive", "quadrant": 0.80, "arbitrage": 0.20, "risk": 3, "risk_name": "High"},
]


def portfolio_weights(key: str = "balanced") -> dict[str, float]:
    p = next((x for x in PORTFOLIOS if x["key"] == key), PORTFOLIOS[1])
    return {"arbitrage": p["arbitrage"], **{s: p["quadrant"] / 4 for s in QUADRANT}}


_SNAPSHOT = Path(__file__).resolve().parent / "data" / "index_history.json"
_BUCKET, _OBJECT = "calc-data", "index_history.json"
_MEM: dict = {"at": 0.0, "data": None}
_LOCK = threading.Lock()
_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124 Safari/537.36"}


# ─────────────────────────────── sources ───────────────────────────────
def _nifty_session() -> httpx.Client:
    c = httpx.Client(timeout=60, headers=_UA, follow_redirects=True)
    c.get("https://www.niftyindices.com/reports/historical-data")   # sets the session cookies
    return c


def _nifty_year(c: httpx.Client, s: dict, y0: date, y1: date) -> dict[str, tuple[str, float]]:
    """{day 'YYYY-MM-DD': close} for one ≤1-year window (the site's limit)."""
    ep = "getTotalReturnIndexString" if s["kind"] == "tri" else "getHistoricaldatatabletoString"
    cinfo = "{'name':'%s','startDate':'%s','endDate':'%s','indexName':'%s'}" % (
        s["nifty"], y0.strftime("%d-%b-%Y"), y1.strftime("%d-%b-%Y"), s["nifty"])
    r = c.post(f"https://www.niftyindices.com/BackPage/{ep}", json={"cinfo": cinfo},
               headers={"X-Requested-With": "XMLHttpRequest", "Origin": "https://www.niftyindices.com",
                        "Referer": "https://www.niftyindices.com/reports/historical-data"})
    out = {}
    for row in r.json() or []:
        d = row.get("Date") or row.get("HistoricalDate")
        v = row.get("TotalReturnsIndex") if s["kind"] == "tri" else row.get("CLOSE")
        try:
            out[datetime.strptime(d.strip(), "%d %b %Y").date().isoformat()] = float(str(v).replace(",", ""))
        except (TypeError, ValueError, AttributeError):
            continue
    return out


def _gold_daily(codes) -> dict[str, float]:
    """Gold ETF NAV per day — one ETF stitched across its AMFI codes (a later
    code wins on a shared day) — with unit splits (≥ 5× one-day moves) scaled out."""
    by_day: dict[str, float] = {}
    for code in ([codes] if isinstance(codes, int) else codes):
        d = httpx.get(f"https://api.mfapi.in/mf/{code}", timeout=60).json()
        for p in d.get("data") or []:
            try:
                nav = float(p["nav"])
            except (TypeError, ValueError):
                continue
            if nav > 0:
                dd, mm, yy = p["date"].split("-")
                by_day[f"{yy}-{mm}-{dd}"] = nav
    rows = sorted(by_day.items())
    factor, out, prev = 1.0, {}, None
    # walk back from today so the latest NAVs keep their real level
    for day, nav in reversed(rows):
        if prev is not None and nav / prev > 5:          # a split happened between these two days
            factor *= round(nav / prev)
        out[day] = nav / factor
        prev = nav
    return out


def _month_end(daily: dict[str, float]) -> dict[str, float]:
    """Last value of each COMPLETE month (the current month isn't a month-end yet)."""
    this_month = date.today().isoformat()[:7]
    out: dict[str, tuple[str, float]] = {}
    for day, v in daily.items():
        m = day[:7]
        if m >= this_month:
            continue
        if m not in out or day > out[m][0]:
            out[m] = (day, v)
    return {m: v for m, (_, v) in sorted(out.items())}


def fetch(full: bool = False) -> dict:
    """Pull the series from their sources. full=True rebuilds everything;
    otherwise only the last ~13 months (merged into what we already have)."""
    today = date.today()
    base = _load_stored() if not full else None
    data = {"as_of": today.isoformat(), "series": {}}
    c = _nifty_session()
    try:
        for s in SERIES:
            months = dict((base or {}).get("series", {}).get(s["key"], {}).get("months", {}))
            if "nifty" in s:
                first = s["from"] if full or not months else today.year - 1
                daily: dict[str, float] = {}
                for y in range(first, today.year + 1):
                    y0 = date(y, 1, 1) if y > s["from"] else date(y, 4, 1)
                    y1 = min(date(y, 12, 31), today)
                    if y0 <= y1:
                        daily.update(_nifty_year(c, s, y0, y1))
                        time.sleep(0.4)                       # be gentle with the site
                months.update(_month_end(daily))
            else:
                # the whole ETF history comes back every time: replace, never merge
                # (so a change of source can't leave old values behind)
                months = {m: v for m, v in _month_end(_gold_daily(s["mfapi"])).items() if m >= f"{s['from']}-01"}
            this_month = today.isoformat()[:7]
            months = {m: v for m, v in months.items() if m < this_month}     # complete months only
            data["series"][s["key"]] = {k: s[k] for k in ("name", "source", "sleeve")}
            data["series"][s["key"]]["months"] = {m: round(v, 4) for m, v in sorted(months.items())}
    finally:
        c.close()
    return data


# ─────────────────────────────── storage ───────────────────────────────
def _sb():
    from app.client_portfolio import _sb as sb
    return sb()


def _load_stored() -> Optional[dict]:
    try:
        # a fresh signed link each time: a plain download can be served from the
        # CDN's cached copy for up to an hour after a refresh overwrote it
        u = _sb().storage.from_(_BUCKET).create_signed_url(_OBJECT, 60)
        url = u.get("signedURL") or u.get("signedUrl")
        r = httpx.get(url, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception:
        pass
    try:
        return json.loads(_SNAPSHOT.read_text())
    except Exception:
        return None


def save(data: dict) -> None:
    body = json.dumps(data, separators=(",", ":")).encode()
    try:
        st = _sb().storage
        try:
            st.create_bucket(_BUCKET, options={"public": False})
        except Exception:
            pass
        # no CDN caching: a refresh must be what the next read gets
        st.from_(_BUCKET).upload(_OBJECT, body, {"content-type": "application/json", "upsert": "true", "cache-control": "0"})
    except Exception:
        pass


def _latest_month(d: Optional[dict]) -> str:
    if not d:
        return ""
    return min((max(v["months"]) for v in d["series"].values() if v.get("months")), default="")


def history() -> dict:
    """The index series (memory → storage → repo snapshot). If they don't reach
    the current month yet, refresh them in the background (at most every 6h)."""
    now = time.time()
    with _LOCK:
        d = _MEM["data"]
        if d is None:
            d = _load_stored()
            _MEM["data"] = d
        t = date.today()
        last_complete = f"{t.year - 1}-12" if t.month == 1 else f"{t.year}-{t.month - 1:02d}"
        stale = _latest_month(d) < last_complete
        if stale and now - _MEM["at"] > 6 * 3600:
            _MEM["at"] = now
            threading.Thread(target=_refresh_bg, daemon=True).start()
    return d or {"series": {}}


def _refresh_bg() -> None:
    try:
        d = fetch(full=False)
        if all(v.get("months") for v in d["series"].values()):
            save(d)
            with _LOCK:
                _MEM["data"] = d
    except Exception:
        pass


# ─────────────────────── the calculators' data shape ───────────────────────
def basket_paths(weights: dict[str, float]) -> dict:
    """/calc/villa-funds: one series per sleeve, month-end values on the common
    window, in the shape the calculators expect ({funds: [{sleeve, name, weight,
    nav: [...]}]}). `weights` = sleeve → share (sums to 1)."""
    h = history().get("series", {})
    rows = []
    for s in SERIES:
        w = weights.get(s["sleeve"], 0)
        if w <= 0:
            continue
        ser = h.get(s["key"])
        if not ser or not ser.get("months"):
            return {"ok": False, "detail": f"No history for {s['name']}."}
        rows.append({"sleeve": s["sleeve"], "name": ser["name"], "source": ser["source"],
                     "weight": w, "months": ser["months"]})
    if not rows:
        return {"ok": False, "detail": "No basket."}
    common = sorted(set.intersection(*(set(r["months"]) for r in rows)))
    # keep only the contiguous run that ends at the latest common month
    run = [common[-1]]
    for m in reversed(common[:-1]):
        y, mo = map(int, run[-1].split("-"))
        prev = f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
        if m != prev:
            break
        run.append(m)
    months = sorted(run)
    return {
        "ok": True, "start": months[0], "end": months[-1], "earliest": months[0], "months": months,
        "basis": "index",
        "funds": [{"sleeve": r["sleeve"], "name": r["name"], "source": r["source"], "weight": r["weight"],
                   "proxy": [], "plan": "Index", "nav": [r["months"][m] for m in months],
                   "index": [round(r["months"][m] / r["months"][months[0]], 6) for m in months]}
                  for r in rows],
        "note": "Benchmark indices — before any fund's expense ratio.",
        "portfolios": PORTFOLIOS,
    }
