"""The calculators' benchmark data — INDICES ONLY, no actively managed funds.

The calculators (FD / Flat / SIP / Lumpsum vs DigiVilla) replay today's DigiVilla
split by sleeve on the BENCHMARK each sleeve tracks, never on an active fund:

    arbitrage  → NIFTY 50 Arbitrage Index              (niftyindices.com, from Apr 2010)
    mid cap    → NIFTY Midcap 150 TRI (total return)   (niftyindices.com, from Apr 2005)
    small cap  → NIFTY Smallcap 250 TRI (total return) (niftyindices.com, from Apr 2005)
    gold       → domestic price of gold, via Invesco India Gold ETF NAV
                 (a passive gold ETF — there is no Nifty gold index; AMFI/mfapi,
                 from Mar 2010; its 1:100 unit split in Apr 2026 is adjusted out)

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
    {"key": "mid", "sleeve": "mid", "name": "NIFTY Midcap 150 TRI",
     "source": "niftyindices.com · total return index", "nifty": "NIFTY MIDCAP 150", "kind": "tri", "from": 2005},
    {"key": "small", "sleeve": "small", "name": "NIFTY Smallcap 250 TRI",
     "source": "niftyindices.com · total return index", "nifty": "NIFTY SMALLCAP 250", "kind": "tri", "from": 2005},
    {"key": "gold", "sleeve": "gold", "name": "Domestic gold price (Invesco India Gold ETF)",
     "source": "AMFI / mfapi · scheme 112368, split-adjusted", "mfapi": 112368, "from": 2010},
]

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


def _gold_daily(code: int) -> dict[str, float]:
    """Gold ETF NAV per day, with unit splits (≥ 5× one-day moves) scaled out."""
    d = httpx.get(f"https://api.mfapi.in/mf/{code}", timeout=60).json()
    rows = []
    for p in d.get("data") or []:
        try:
            nav = float(p["nav"])
        except (TypeError, ValueError):
            continue
        if nav > 0:
            dd, mm, yy = p["date"].split("-")
            rows.append((f"{yy}-{mm}-{dd}", nav))
    rows.sort()
    factor, out, prev = 1.0, {}, None
    # walk back from today so the latest NAVs keep their real level
    for day, nav in reversed(rows):
        if prev is not None and nav / prev > 5:          # a split happened between these two days
            factor *= round(nav / prev)
        out[day] = nav / factor
        prev = nav
    return out


def _month_end(daily: dict[str, float]) -> dict[str, float]:
    out: dict[str, tuple[str, float]] = {}
    for day, v in daily.items():
        m = day[:7]
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
                months.update({m: v for m, v in _month_end(_gold_daily(s["mfapi"])).items()
                               if m >= f"{s['from']}-01"})
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
        raw = _sb().storage.from_(_BUCKET).download(_OBJECT)
        return json.loads(raw)
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
        st.from_(_BUCKET).upload(_OBJECT, body, {"content-type": "application/json", "upsert": "true"})
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
        stale = _latest_month(d) < date.today().isoformat()[:7]
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
    }
