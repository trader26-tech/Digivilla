"""World markets today — Indian and global indices for the admin's "Villas vs market" page.

Quotes and charts come from Yahoo Finance's public chart API (no key), fetched on
the server and cached so the page never hammers it:
  quotes()          every index: last, previous close, day change, day range, a
                    small intraday line — cached 60 s
  chart(key, range) one index over 1D … 5Y — cached 60 s for 1D/5D, 15 min otherwise
  history(key)      one index's DAILY closes since 2000, in its own currency AND in US
                    dollars — cached 6 h; the page slices any time frame from it
If Yahoo refuses (rate limit), the last good copy is served.
"""

from __future__ import annotations

import threading
import time
from typing import Optional
from urllib.parse import quote

import httpx

INDICES = [
    # India
    {"key": "nifty50", "symbol": "^NSEI", "name": "Nifty 50", "region": "India"},
    {"key": "nifty500", "symbol": "^CRSLDX", "name": "Nifty 500", "region": "India"},
    {"key": "sensex", "symbol": "^BSESN", "name": "Sensex", "region": "India"},
    {"key": "banknifty", "symbol": "^NSEBANK", "name": "Nifty Bank", "region": "India"},
    {"key": "midcap50", "symbol": "^NSEMDCP50", "name": "Nifty Midcap 50", "region": "India"},
    # Nippon India ETF Gold BeES — the ETF behind Nippon India Gold Savings Fund (the mutual-fund route)
    {"key": "goldbees", "symbol": "GOLDBEES.NS", "name": "Nippon India Gold BeES", "region": "India"},
    # United States
    {"key": "sp500", "symbol": "^GSPC", "name": "S&P 500", "region": "US"},
    {"key": "nasdaq", "symbol": "^IXIC", "name": "Nasdaq Composite", "region": "US"},
    {"key": "nasdaq100", "symbol": "^NDX", "name": "Nasdaq-100", "region": "US"},
    {"key": "dow", "symbol": "^DJI", "name": "Dow Jones", "region": "US"},
    # Asia
    {"key": "kospi", "symbol": "^KS11", "name": "KOSPI (South Korea)", "region": "Asia"},
    {"key": "nikkei", "symbol": "^N225", "name": "Nikkei 225 (Japan)", "region": "Asia"},
    {"key": "hangseng", "symbol": "^HSI", "name": "Hang Seng (Hong Kong)", "region": "Asia"},
    {"key": "shanghai", "symbol": "000001.SS", "name": "Shanghai Composite", "region": "Asia"},
    {"key": "taiwan", "symbol": "^TWII", "name": "Taiwan Weighted", "region": "Asia"},
    # Europe
    {"key": "ftse", "symbol": "^FTSE", "name": "FTSE 100 (UK)", "region": "Europe"},
    {"key": "dax", "symbol": "^GDAXI", "name": "DAX (Germany)", "region": "Europe"},
    {"key": "cac", "symbol": "^FCHI", "name": "CAC 40 (France)", "region": "Europe"},
    {"key": "stoxx50", "symbol": "^STOXX50E", "name": "Euro Stoxx 50", "region": "Europe"},
    # Global & other
    {"key": "msciworld", "symbol": "URTH", "name": "MSCI World (ETF)", "region": "Global"},
    # gold is priced in US$; its "local" view is in RUPEES (US$ price × ₹ per US$), as an Indian investor holds it
    {"key": "gold", "symbol": "GC=F", "name": "Gold", "region": "Global", "local": "INR"},
    # US Treasury yields — a YIELD in % a year, not a price: shown as its level and moves in
    # basis points (1 bp = 0.01 percentage point); no currency conversion
    {"key": "us3m", "symbol": "^IRX", "name": "US 3-month T-bill", "region": "Bonds", "kind": "yield"},
    {"key": "us5y", "symbol": "^FVX", "name": "US 5-year Treasury", "region": "Bonds", "kind": "yield"},
    {"key": "us10y", "symbol": "^TNX", "name": "US 10-year Treasury", "region": "Bonds", "kind": "yield"},
    {"key": "us30y", "symbol": "^TYX", "name": "US 30-year Treasury", "region": "Bonds", "kind": "yield"},
    # crude oil, US$ a barrel (front-month futures); "local" = in rupees, like gold
    {"key": "wti", "symbol": "CL=F", "name": "Crude oil · WTI", "region": "Commodities", "local": "INR", "unit": "$/bbl"},
    {"key": "brent", "symbol": "BZ=F", "name": "Crude oil · Brent", "region": "Commodities", "local": "INR", "unit": "$/bbl"},
]
REGIONS = ["India", "US", "Asia", "Europe", "Global", "Bonds", "Commodities"]
# every index is also shown in US DOLLARS: local value ÷ (local currency per USD)
FX = {"INR": "INR=X", "KRW": "KRW=X", "JPY": "JPY=X", "HKD": "HKD=X", "CNY": "CNY=X",
      "TWD": "TWD=X", "GBP": "GBP=X", "EUR": "EUR=X"}
RANGES = {  # range → (yahoo range, interval, cache seconds)
    "1d": ("1d", "5m", 60), "5d": ("5d", "15m", 60), "1m": ("1mo", "1d", 900),
    "6m": ("6mo", "1d", 900), "1y": ("1y", "1d", 900), "5y": ("5y", "1wk", 900),
}
_BY_KEY = {i["key"]: i for i in INDICES}
_UA = {"User-Agent": "Mozilla/5.0"}   # Yahoo answers a plain UA; a full browser UA without cookies gets 429
_CACHE: dict = {}
_LOCK = threading.Lock()


def _get(symbol: str, rng: str, interval: str) -> Optional[dict]:
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
           f"?range={rng}&interval={interval}&includePrePost=false")
    try:
        r = httpx.get(url, headers=_UA, timeout=15)
        if r.status_code != 200:
            return None
        res = (r.json().get("chart") or {}).get("result") or []
        return res[0] if res else None
    except Exception:
        return None


def _points(res: dict) -> list[list]:
    ts = res.get("timestamp") or []
    closes = (((res.get("indicators") or {}).get("quote") or [{}])[0].get("close")) or []
    return [[t, round(c, 4)] for t, c in zip(ts, closes) if c is not None]


def _cached(key: str, ttl: int, fn):
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    if val is None and hit:
        return hit[1]                      # Yahoo refused: keep the last good copy
    if val is not None:
        with _LOCK:
            _CACHE[key] = (time.time(), val)
    return val


def _spark(symbols: list[str]) -> dict[str, dict]:
    """One batched request for many symbols (Yahoo's spark API) → {symbol: response}."""
    url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols="
           + ",".join(quote(s) for s in symbols) + "&range=1d&interval=5m")
    try:
        r = httpx.get(url, headers=_UA, timeout=20)
        if r.status_code != 200:
            return {}
        out = {}
        for x in (r.json().get("spark") or {}).get("result") or []:
            resp = (x.get("response") or [None])[0]
            if resp:
                out[x.get("symbol")] = resp
        return out
    except Exception:
        return {}


def _at(series: list[list], t: float) -> Optional[float]:
    """The FX rate in force at time t (the last one at or before t, else the first)."""
    if not series:
        return None
    best = series[0][1]
    for ts, v in series:
        if ts <= t:
            best = v
        else:
            break
    return best


def _row(ix: dict, res: dict, fx: Optional[dict]) -> dict:
    m = res.get("meta") or {}
    last, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
    pts = _points(res)
    ccy = m.get("currency")
    # US-dollar terms: divide by the currency's rate now and at the previous close
    if fx and ccy in FX:
        fm = fx.get("meta") or {}
        fx_now, fx_prev = fm.get("regularMarketPrice"), fm.get("chartPreviousClose") or fm.get("previousClose")
        fx_pts = _points(fx)
        usd_last = last / fx_now if last is not None and fx_now else None
        usd_prev = prev / fx_prev if prev and fx_prev else None
        usd_pts = [[t, v / r] for t, v in pts if (r := _at(fx_pts, t))]
        fx_pct = (fx_prev / fx_now - 1) * 100 if fx_now and fx_prev else None   # + = the currency gained vs USD
    elif ccy == "USD":
        usd_last, usd_prev, usd_pts, fx_pct = last, prev, pts, 0.0
    else:
        usd_last = usd_prev = fx_pct = None
        usd_pts = []
    step = max(1, len(usd_pts or pts) // 48)          # a light sparkline
    return {
        **ix, "currency": ccy, "last": last, "prev_close": prev,
        "change": (last - prev) if last is not None and prev else None,
        "change_pct": ((last / prev - 1) * 100) if last is not None and prev else None,
        "usd_last": usd_last, "usd_prev": usd_prev,
        "usd_change_pct": ((usd_last / usd_prev - 1) * 100) if usd_last and usd_prev else None,
        "fx_pct": fx_pct,
        "day_high": m.get("regularMarketDayHigh"), "day_low": m.get("regularMarketDayLow"),
        "high_52w": m.get("fiftyTwoWeekHigh"), "low_52w": m.get("fiftyTwoWeekLow"),
        "time": m.get("regularMarketTime"), "tz": m.get("exchangeTimezoneName"),
        "spark": [p[1] for p in (usd_pts or pts)[::step]],
        "change_bp": round((last - prev) * 100, 1) if ix.get("kind") == "yield" and last is not None and prev else None,
    }


def _to_local(row: dict, fx: Optional[dict]) -> dict:
    """A US$-priced index shown locally in another currency (gold → ₹): its own-currency
    figures become US$ × that currency per US$; the US$ figures stay as they are."""
    fm = (fx or {}).get("meta") or {}
    now, prev = fm.get("regularMarketPrice"), fm.get("chartPreviousClose") or fm.get("previousClose")
    if not now or not prev or row.get("currency") != "USD":
        return row
    mul = lambda v, r=now: v * r if v is not None else None
    last, pc = mul(row["usd_last"]), mul(row["usd_prev"], prev)
    return {**row, "currency": row["local"], "last": last, "prev_close": pc,
            "change": (last - pc) if last is not None and pc else None,
            "change_pct": ((last / pc - 1) * 100) if last is not None and pc else None,
            "fx_pct": (prev / now - 1) * 100,
            "day_high": mul(row["day_high"]), "day_low": mul(row["day_low"]),
            "high_52w": mul(row["high_52w"]), "low_52w": mul(row["low_52w"])}


def _yield_52w(symbol: str) -> dict:
    """Yahoo's 52-week low for a yield index is often 0 — work it out from a year of daily closes (cached 6 h)."""
    def load():
        res = _get(symbol, "1y", "1d")
        vals = [v for _, v in _points(res)] if res else []
        return {"low_52w": min(vals), "high_52w": max(vals)} if vals else None
    return _cached(f"52w:{symbol}", 6 * 3600, load) or {}


def quotes() -> dict:
    def load():
        syms = [x["symbol"] for x in INDICES] + list(FX.values())
        got: dict[str, dict] = {}
        for i in range(0, len(syms), 10):          # Yahoo takes ~20 symbols a call; stay well under
            got.update(_spark(syms[i:i + 10]))
        rows = []
        for ix in INDICES:
            res = got.get(ix["symbol"])
            if not res:
                continue
            ccy = (res.get("meta") or {}).get("currency")
            row = _row(ix, res, got.get(FX.get(ccy, "")))
            if ix.get("local") in FX:
                row = _to_local(row, got.get(FX[ix["local"]]))
            if ix.get("kind") == "yield":
                row = {**row, **_yield_52w(ix["symbol"])}
            rows.append(row)
        return rows or None
    rows = _cached("quotes", 60, load) or []
    return {"regions": REGIONS, "indices": rows, "as_of": int(time.time()), "basis": "USD"}


def chart(key: str, rng: str = "1d", ccy: str = "usd") -> Optional[dict]:
    """One index over the range, in US DOLLARS (local value ÷ that day's/minute's FX rate),
    or in its own currency with ccy='local'."""
    ix = _BY_KEY.get(key)
    if not ix or rng not in RANGES:
        return None
    yr, iv, ttl = RANGES[rng]
    want = "local" if ccy == "local" else "usd"

    def load():
        res = _get(ix["symbol"], yr, iv)
        if not res:
            return None
        m = res.get("meta") or {}
        ccy = m.get("currency")
        pts, prev = _points(res), m.get("chartPreviousClose")
        if ccy in FX and want == "usd":
            fx = _get(FX[ccy], yr, iv)
            if not fx:
                return None
            fx_pts = _points(fx)
            fx_prev = (fx.get("meta") or {}).get("chartPreviousClose")
            pts = [[t, v / r] for t, v in pts if (r := _at(fx_pts, t))]
            prev = prev / fx_prev if prev and fx_prev else None
        elif want == "local" and ix.get("local") in FX and ccy == "USD":
            fx = _get(FX[ix["local"]], yr, iv)
            if not fx:
                return None
            fx_pts = _points(fx)
            fx_prev = (fx.get("meta") or {}).get("chartPreviousClose")
            pts = [[t, v * r] for t, v in pts if (r := _at(fx_pts, t))]
            prev = prev * fx_prev if prev and fx_prev else None
            return {"key": key, "name": ix["name"], "range": rng, "currency": ix["local"],
                    "local_currency": ix["local"], "prev_close": prev, "points": pts}
        return {"key": key, "name": ix["name"], "range": rng, "currency": "USD" if want == "usd" or ccy == "USD" else ccy,
                "local_currency": ccy, "prev_close": prev, "points": pts}
    return _cached(f"c:{key}:{rng}:{want}", ttl, load)


HISTORY_FROM = 946684800      # 1 Jan 2000 — Yahoo returns DAILY closes for a period1/period2 window


def _daily(symbol: str) -> Optional[dict]:
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
           f"?period1={HISTORY_FROM}&period2={int(time.time()) + 86400}&interval=1d&includePrePost=false")
    try:
        r = httpx.get(url, headers=_UA, timeout=30)
        if r.status_code != 200:
            return None
        res = (r.json().get("chart") or {}).get("result") or []
        return res[0] if res else None
    except Exception:
        return None


def _fx_history(ccy: str) -> Optional[list]:
    """Daily <ccy> per US$ since 2000, cached per currency."""
    return _cached(f"fx:{ccy}", 6 * 3600, lambda: (lambda r: _points(r) if r else None)(_daily(FX[ccy])))


def history(key: str) -> Optional[dict]:
    """One index's daily closes since 2000: d = day number (days since 1970-01-01, UTC),
    v = close in its own currency, u = close in US dollars (v ÷ that day's FX rate)."""
    ix = _BY_KEY.get(key)
    if not ix:
        return None

    def load():
        res = _daily(ix["symbol"])
        if not res:
            return None
        ccy = (res.get("meta") or {}).get("currency")
        pts = _points(res)
        fx_pts = None
        to_local = ix.get("local") if ccy == "USD" and ix.get("local") in FX else None
        if to_local:                            # e.g. gold: u = the US$ price, v = US$ × ₹ per US$
            fx_pts = _fx_history(to_local)
            if not fx_pts:
                return None
            d, v, u, seen, j = [], [], [], set(), 0
            for t, c in pts:
                day = int(t // 86400)
                if day in seen:
                    continue
                seen.add(day)
                while j + 1 < len(fx_pts) and fx_pts[j + 1][0] <= t:
                    j += 1
                r = fx_pts[j][1]
                if not r:
                    continue
                d.append(day)
                v.append(round(c * r, 4))
                u.append(round(c, 6))
            return {"key": key, "name": ix["name"], "region": ix["region"], "kind": ix.get("kind"), "currency": to_local, "d": d, "v": v, "u": u}
        if ccy in FX:
            fx_pts = _fx_history(ccy)
            if not fx_pts:
                return None
        d, v, u, seen = [], [], [], set()
        j = 0                                   # walk the FX series alongside (both are in time order)
        for t, c in pts:
            day = int(t // 86400)
            if day in seen:
                continue
            seen.add(day)
            if fx_pts is not None:
                while j + 1 < len(fx_pts) and fx_pts[j + 1][0] <= t:
                    j += 1
                r = fx_pts[j][1]
                if not r:
                    continue
                usd = c / r
            elif ccy == "USD":
                usd = c
            else:
                usd = None
            d.append(day)
            v.append(round(c, 4))
            u.append(round(usd, 6) if usd is not None else None)
        return {"key": key, "name": ix["name"], "region": ix["region"], "kind": ix.get("kind"), "currency": ccy, "d": d, "v": v, "u": u}
    return _cached(f"h:{key}", 6 * 3600, load)
