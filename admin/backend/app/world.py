"""World markets today — Indian and global indices for the admin's "Villas vs market" page.

Quotes and charts come from Yahoo Finance's public chart API (no key), fetched on
the server and cached so the page never hammers it:
  quotes()          every index: last, previous close, day change, day range, a
                    small intraday line — cached 60 s. The PREVIOUS CLOSE is taken from
                    the daily bars (the last close of a session before the one the
                    latest price belongs to) — Yahoo's own "previous close" field is
                    sometimes a session or two stale for Indian indices, which showed
                    Nifty up on a down day (14 Oct 2026).
  chart(key, range) one index over 1D … 5Y — cached 60 s for 1D/5D, 15 min otherwise
  history(key)      one index's DAILY closes since 2000, in its own currency AND in US
                    dollars — cached 6 h; the page slices any time frame from it
If Yahoo refuses (rate limit), the last good copy is served.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

INDICES = [
    # India
    {"key": "nifty50", "flag": "🇮🇳", "symbol": "^NSEI", "name": "Nifty 50", "region": "India"},
    {"key": "nifty500", "flag": "🇮🇳", "symbol": "^CRSLDX", "name": "Nifty 500", "region": "India"},
    {"key": "nifty100", "flag": "🇮🇳", "symbol": "^CNX100", "name": "Nifty 100 (large cap)", "region": "India"},
    {"key": "next50", "flag": "🇮🇳", "symbol": "^NSMIDCP", "name": "Nifty Next 50", "region": "India"},
    {"key": "midcap150", "flag": "🇮🇳", "symbol": "NIFTYMIDCAP150.NS", "name": "Nifty Midcap 150", "region": "India"},
    {"key": "smallcap250", "flag": "🇮🇳", "symbol": "NIFTYSMLCAP250.NS", "name": "Nifty Smallcap 250", "region": "India"},
    {"key": "sensex", "flag": "🇮🇳", "symbol": "^BSESN", "name": "Sensex", "region": "India"},
    {"key": "banknifty", "flag": "🇮🇳", "symbol": "^NSEBANK", "name": "Nifty Bank", "region": "India"},
    {"key": "midcap50", "flag": "🇮🇳", "symbol": "^NSEMDCP50", "name": "Nifty Midcap 50", "region": "India"},
    # Nippon India ETF Gold BeES — the ETF behind Nippon India Gold Savings Fund (the mutual-fund route)
    {"key": "goldbees", "flag": "🇮🇳", "symbol": "GOLDBEES.NS", "name": "Nippon India Gold BeES", "region": "India"},
    # United States
    {"key": "sp500", "flag": "🇺🇸", "symbol": "^GSPC", "name": "S&P 500", "region": "US"},
    {"key": "nasdaq", "flag": "🇺🇸", "symbol": "^IXIC", "name": "Nasdaq Composite", "region": "US"},
    {"key": "nasdaq100", "flag": "🇺🇸", "symbol": "^NDX", "name": "Nasdaq-100", "region": "US"},
    {"key": "dow", "flag": "🇺🇸", "symbol": "^DJI", "name": "Dow Jones", "region": "US"},
    {"key": "russell", "flag": "🇺🇸", "symbol": "^RUT", "name": "Russell 2000", "region": "US"},
    {"key": "vix", "flag": "🇺🇸", "symbol": "^VIX", "name": "VIX (fear gauge)", "region": "US"},
    # the rest of the Americas
    {"key": "tsx", "flag": "🇨🇦", "symbol": "^GSPTSE", "name": "S&P/TSX (Canada)", "region": "Americas"},
    {"key": "bovespa", "flag": "🇧🇷", "symbol": "^BVSP", "name": "Bovespa (Brazil)", "region": "Americas"},
    {"key": "ipc", "flag": "🇲🇽", "symbol": "^MXX", "name": "IPC (Mexico)", "region": "Americas"},
    # Asia
    {"key": "kospi", "flag": "🇰🇷", "symbol": "^KS11", "name": "KOSPI (South Korea)", "region": "Asia"},
    {"key": "nikkei", "flag": "🇯🇵", "symbol": "^N225", "name": "Nikkei 225 (Japan)", "region": "Asia"},
    {"key": "hangseng", "flag": "🇭🇰", "symbol": "^HSI", "name": "Hang Seng (Hong Kong)", "region": "Asia"},
    {"key": "shanghai", "flag": "🇨🇳", "symbol": "000001.SS", "name": "Shanghai Composite", "region": "Asia"},
    {"key": "taiwan", "flag": "🇹🇼", "symbol": "^TWII", "name": "Taiwan Weighted", "region": "Asia"},
    {"key": "asx", "flag": "🇦🇺", "symbol": "^AXJO", "name": "ASX 200 (Australia)", "region": "Asia"},
    {"key": "sti", "flag": "🇸🇬", "symbol": "^STI", "name": "Straits Times (Singapore)", "region": "Asia"},
    {"key": "jakarta", "flag": "🇮🇩", "symbol": "^JKSE", "name": "Jakarta Composite", "region": "Asia"},
    # Europe
    {"key": "ftse", "flag": "🇬🇧", "symbol": "^FTSE", "name": "FTSE 100 (UK)", "region": "Europe"},
    {"key": "dax", "flag": "🇩🇪", "symbol": "^GDAXI", "name": "DAX (Germany)", "region": "Europe"},
    {"key": "cac", "flag": "🇫🇷", "symbol": "^FCHI", "name": "CAC 40 (France)", "region": "Europe"},
    {"key": "stoxx50", "flag": "🇪🇺", "symbol": "^STOXX50E", "name": "Euro Stoxx 50", "region": "Europe"},
    {"key": "ibex", "flag": "🇪🇸", "symbol": "^IBEX", "name": "IBEX 35 (Spain)", "region": "Europe"},
    {"key": "ftsemib", "flag": "🇮🇹", "symbol": "FTSEMIB.MI", "name": "FTSE MIB (Italy)", "region": "Europe"},
    {"key": "smi", "flag": "🇨🇭", "symbol": "^SSMI", "name": "SMI (Switzerland)", "region": "Europe"},
    {"key": "aex", "flag": "🇳🇱", "symbol": "^AEX", "name": "AEX (Netherlands)", "region": "Europe"},
    # Global & other
    {"key": "msciworld", "flag": "🌐", "symbol": "URTH", "name": "MSCI World (ETF)", "region": "Global"},
    # (no raw gold-futures row: gold is shown as the Gold BeES ETF under India — what an Indian investor holds)
    {"key": "bitcoin", "flag": "₿", "symbol": "BTC-USD", "name": "Bitcoin", "region": "Global"},
    # currencies — a RATE, shown as quoted (no US$ conversion of a US$ rate)
    {"key": "usdinr", "flag": "🇮🇳", "symbol": "INR=X", "name": "US$ in rupees", "region": "Currencies", "kind": "fx"},
    {"key": "dxy", "flag": "🇺🇸", "symbol": "DX-Y.NYB", "name": "US Dollar Index", "region": "Currencies", "kind": "fx"},
    {"key": "eurusd", "flag": "🇪🇺", "symbol": "EURUSD=X", "name": "Euro in US$", "region": "Currencies", "kind": "fx"},
    {"key": "gbpusd", "flag": "🇬🇧", "symbol": "GBPUSD=X", "name": "Pound in US$", "region": "Currencies", "kind": "fx"},
    {"key": "usdjpy", "flag": "🇯🇵", "symbol": "JPY=X", "name": "US$ in yen", "region": "Currencies", "kind": "fx"},
    # US Treasury yields — a YIELD in % a year, not a price: shown as its level and moves in
    # basis points (1 bp = 0.01 percentage point); no currency conversion
    {"key": "us3m", "flag": "🇺🇸", "symbol": "^IRX", "name": "US 3-month T-bill", "region": "Bonds", "kind": "yield"},
    {"key": "us5y", "flag": "🇺🇸", "symbol": "^FVX", "name": "US 5-year Treasury", "region": "Bonds", "kind": "yield"},
    {"key": "us10y", "flag": "🇺🇸", "symbol": "^TNX", "name": "US 10-year Treasury", "region": "Bonds", "kind": "yield"},
    {"key": "us30y", "flag": "🇺🇸", "symbol": "^TYX", "name": "US 30-year Treasury", "region": "Bonds", "kind": "yield"},
    # crude oil, US$ a barrel (front-month futures); "local" = in rupees, like gold
    {"key": "wti", "flag": "🛢️", "symbol": "CL=F", "name": "Crude oil · WTI", "region": "Commodities", "local": "INR", "unit": "$/bbl"},
    {"key": "brent", "flag": "🛢️", "symbol": "BZ=F", "name": "Crude oil · Brent", "region": "Commodities", "local": "INR", "unit": "$/bbl"},
    {"key": "silver", "flag": "🥈", "symbol": "SI=F", "name": "Silver", "region": "Commodities", "unit": "$/oz"},
    {"key": "copper", "flag": "🟠", "symbol": "HG=F", "name": "Copper", "region": "Commodities", "unit": "$/lb"},
    {"key": "natgas", "flag": "🔥", "symbol": "NG=F", "name": "Natural gas", "region": "Commodities", "unit": "$/MMBtu"},
]
REGIONS = ["India", "US", "Americas", "Europe", "Asia", "Global", "Currencies", "Commodities", "Bonds"]
# every index is also shown in US DOLLARS: local value ÷ (local currency per USD)
FX = {"INR": "INR=X", "KRW": "KRW=X", "JPY": "JPY=X", "HKD": "HKD=X", "CNY": "CNY=X",
      "TWD": "TWD=X", "GBP": "GBP=X", "EUR": "EUR=X", "CAD": "CAD=X", "BRL": "BRL=X", "MXN": "MXN=X",
      "AUD": "AUD=X", "SGD": "SGD=X", "IDR": "IDR=X", "CHF": "CHF=X"}
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


def _spark(symbols: list[str], rng: str = "1d", interval: str = "5m") -> dict[str, dict]:
    """One batched request for many symbols (Yahoo's spark API) → {symbol: response}."""
    url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols="
           + ",".join(quote(s) for s in symbols) + f"&range={rng}&interval={interval}")
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


def _session_date(m: dict) -> Optional[str]:
    """The exchange-local date the latest price belongs to (ISO), from regularMarketTime."""
    t = m.get("regularMarketTime")
    if not t:
        return None
    try:
        return datetime.fromtimestamp(t, ZoneInfo(m.get("exchangeTimezoneName") or "UTC")).date().isoformat()
    except Exception:
        return datetime.utcfromtimestamp(t).date().isoformat()


def _prev_close(m: dict, bars: Optional[dict]) -> tuple[Optional[float], Optional[str]]:
    """The last close of a session BEFORE the one the latest price belongs to, from the
    daily bars (→ (close, date)); Yahoo's previousClose fields are the fallback."""
    fallback = (m.get("chartPreviousClose") or m.get("previousClose"), None)
    # A future (NG=F, CL=F …) rolls to the next contract on expiry day, so the continuous daily
    # bars put the OLD contract's close before the NEW one's price (natgas Nov→Dec showed +17%).
    # Yahoo's previousClose on the intraday meta is the current contract's own close — use it.
    # Currencies and crypto trade round the clock and their daily-bar "close" is a snapshot at an
    # odd hour (₹/US$ bar 94.94 while the day opened at 95.18 → +0.18% on a −0.07% day); their
    # previousClose is the rate at the day's start, where the intraday line begins.
    if m.get("instrumentType") in ("FUTURE", "CURRENCY", "CRYPTOCURRENCY") and m.get("previousClose"):
        return m["previousClose"], (_prev_close({k: v for k, v in m.items() if k != "instrumentType"}, bars)[1] if bars else None)
    if not bars:
        return fallback
    session = _session_date(m)
    if not session:
        return fallback
    try:
        tz = ZoneInfo(m.get("exchangeTimezoneName") or "UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    best = None
    for t, c in _points(bars):
        d = datetime.fromtimestamp(t, tz).date().isoformat()
        if d < session and c:
            best = (c, d)
    return best or fallback


def _row(ix: dict, res: dict, fx: Optional[dict], bars: Optional[dict] = None, fx_bars: Optional[dict] = None) -> dict:
    m = res.get("meta") or {}
    last = m.get("regularMarketPrice")
    prev, prev_date = _prev_close(m, bars)
    pts = _points(res)
    ccy = m.get("currency")
    # US-dollar terms: divide by the currency's rate now and at the previous close
    if ix.get("kind") == "fx":                          # a currency rate is shown as quoted
        usd_last, usd_prev, usd_pts, fx_pct = last, prev, pts, None
    elif fx and ccy in FX:
        fm = fx.get("meta") or {}
        fx_now, fx_prev = fm.get("regularMarketPrice"), _prev_close(fm, fx_bars)[0]
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
        # today's (or the next) regular session on the exchange: open → close, epoch seconds
        "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
        "open_at": ((m.get("currentTradingPeriod") or {}).get("regular") or {}).get("start"),
        "close_at": ((m.get("currentTradingPeriod") or {}).get("regular") or {}).get("end"),
        "session": _session_date(m), "prev_date": prev_date,
        "spark": [p[1] for p in (usd_pts or pts)[::step]],
        "change_bp": round((last - prev) * 100, 1) if ix.get("kind") == "yield" and last is not None and prev else None,
    }


def _to_local(row: dict, fx: Optional[dict], fx_bars: Optional[dict] = None) -> dict:
    """A US$-priced index shown locally in another currency (gold → ₹): its own-currency
    figures become US$ × that currency per US$; the US$ figures stay as they are."""
    fm = (fx or {}).get("meta") or {}
    now, prev = fm.get("regularMarketPrice"), _prev_close(fm, fx_bars)[0]
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
        bars: dict[str, dict] = {}
        chunks = [syms[i:i + 10] for i in range(0, len(syms), 10)]   # Yahoo takes ~20 symbols a call; stay well under
        with ThreadPoolExecutor(max_workers=8) as ex:               # intraday lines + daily bars, all batches at once
            intraday = list(ex.map(lambda c: _spark(c), chunks))
            dailies = list(ex.map(lambda c: _spark(c, "1mo", "1d"), chunks))   # daily bars → the true previous close
        for g in intraday:
            got.update(g)
        for b in dailies:
            bars.update(b)
        for sym, b in bars.items():
            with _LOCK:
                _CACHE[f"bars:{sym}"] = (time.time(), b)
        rows = []
        for ix in INDICES:
            res = got.get(ix["symbol"])
            if not res:
                continue
            ccy = (res.get("meta") or {}).get("currency")
            fxs = FX.get(ccy, "")
            row = _row(ix, res, got.get(fxs), bars.get(ix["symbol"]), bars.get(fxs))
            if ix.get("local") in FX:
                row = _to_local(row, got.get(FX[ix["local"]]), bars.get(FX[ix["local"]]))
            if ix.get("kind") == "yield":
                row = {**row, **_yield_52w(ix["symbol"])}
            rows.append(row)
        return rows or None
    rows = _cached("quotes", 60, load) or []
    hit = _CACHE.get("quotes")
    return {"regions": REGIONS, "indices": rows, "as_of": int(hit[0]) if hit else int(time.time()), "basis": "USD"}


def _daily_bars(symbol: str) -> Optional[dict]:
    """A month of daily bars for one symbol (filled by quotes() in batches; fetched alone otherwise), cached 10 min."""
    return _cached(f"bars:{symbol}", 600, lambda: _spark([symbol], "1mo", "1d").get(symbol))


# ── futures: the continuous symbol (NG=F) jumps contracts on every expiry, so its history
# carries a fake move each roll (natgas Nov 2.60 → Dec 3.06 = "+17%"). Period moves and charts
# use the dated contract it quotes today instead (NGZ26.NYM), whose prices are all one contract.
_MONTH_CODES = "FGHJKMNQUVXZ"


def _contract(symbol: str) -> Optional[str]:
    """The dated contract a continuous future is quoting now: of the next five delivery months,
    the one whose price equals the continuous price (Brent's name carries no month). Cached 1 h."""
    if not symbol.endswith("=F"):
        return None

    def load():
        m = (_get(symbol, "1d", "5m") or {}).get("meta") or {}
        px, ex = m.get("regularMarketPrice"), m.get("exchangeName")
        if not px or not ex:
            return None
        today = datetime.now(ZoneInfo("UTC")).date()
        best = None
        for k in range(5):
            n = today.month - 1 + k
            c = f"{symbol[:-2]}{_MONTH_CODES[n % 12]}{(today.year + n // 12) % 100:02d}.{ex}"
            cp = ((_get(c, "1d", "5m") or {}).get("meta") or {}).get("regularMarketPrice")
            if cp and (best is None or abs(cp / px - 1) < best[0]):
                best = (abs(cp / px - 1), c)
        return best[1] if best and best[0] < 0.002 else None
    return _cached(f"contract:{symbol}", 3600, load)


def _splice(cont: list, own: list) -> list:
    """The contract's own closes, and before its first day the continuous series scaled to meet it."""
    if not own:
        return cont
    t0, v0 = own[0]
    base = _at(cont, t0)
    k = v0 / base if base else 1.0
    return [[t, v * k] for t, v in cont if t < t0] + [list(p) for p in own]


def chart(key: str, rng: str = "1d", ccy: str = "usd") -> Optional[dict]:
    """One index over the range, in US DOLLARS (local value ÷ that day's/minute's FX rate),
    or in its own currency with ccy='local'."""
    ix = _BY_KEY.get(key)
    if not ix or rng not in RANGES:
        return None
    yr, iv, ttl = RANGES[rng]
    want = "local" if ccy == "local" else "usd"

    def load():
        res = None
        if rng != "1d" and (c := _contract(ix["symbol"])):   # a future: one contract's prices, no roll jump
            res = _get(c, yr, iv)
        res = res or _get(ix["symbol"], yr, iv)
        if not res:
            return None
        m = res.get("meta") or {}
        ccy = m.get("currency")
        pts = _points(res)
        prev = _prev_close(m, _daily_bars(ix["symbol"]))[0] if rng == "1d" else m.get("chartPreviousClose")
        if ccy in FX and want == "usd" and ix.get("kind") != "fx":
            fx = _get(FX[ccy], yr, iv)
            if not fx:
                return None
            fx_pts = _points(fx)
            fx_prev = _prev_close(fx.get("meta") or {}, _daily_bars(FX[ccy]))[0] if rng == "1d" else (fx.get("meta") or {}).get("chartPreviousClose")
            pts = [[t, v / r] for t, v in pts if (r := _at(fx_pts, t))]
            prev = prev / fx_prev if prev and fx_prev else None
        elif want == "local" and ix.get("local") in FX and ccy == "USD":
            fx = _get(FX[ix["local"]], yr, iv)
            if not fx:
                return None
            fx_pts = _points(fx)
            fx_prev = _prev_close(fx.get("meta") or {}, _daily_bars(FX[ix["local"]]))[0] if rng == "1d" else (fx.get("meta") or {}).get("chartPreviousClose")
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
    if key.startswith(FUND_PREFIX):
        return fund_history(key)
    ix = _BY_KEY.get(key)
    if not ix:
        return None

    def load():
        res = _daily(ix["symbol"])
        if not res:
            return None
        ccy = (res.get("meta") or {}).get("currency")
        pts = _points(res)
        if c := _contract(ix["symbol"]):        # a future: the current contract's own closes
            pts = _splice(pts, _points(_daily(c) or {}))
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
        is_fx = ix.get("kind") == "fx"
        if ccy in FX and not is_fx:
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
            elif ccy == "USD" or is_fx:
                usd = c
            else:
                usd = None
            d.append(day)
            v.append(round(c, 4))
            u.append(round(usd, 6) if usd is not None else None)
        return {"key": key, "name": ix["name"], "region": ix["region"], "kind": ix.get("kind"), "currency": ccy, "d": d, "v": v, "u": u}
    return _cached(f"h:{key}", 6 * 3600, load)


# ─────────────────────────── our funds (the villa buckets) ───────────────────────────
# Mutual funds have no intraday price: one NAV a business day, published by AMFI in the
# evening (usually 9–11 pm IST) for that day's 3:30 pm close. Latest NAV from AMFI's own
# file (re-read every 15 min), history from mfapi (6 h memo) — the same sources the rest
# of the admin uses.
FUND_PREFIX = "fund:"
_SLEEVE_ORDER = {"arbitrage": 0, "gold": 1, "large": 2, "mid": 3, "small": 4}
_IST = ZoneInfo("Asia/Kolkata")


def _fund_list() -> list[dict]:
    from app import market
    _, rows = market._bucket_funds()
    out: dict[int, dict] = {}
    for r in rows:
        code = r.get("scheme_code")
        if code and int(code) not in out:
            out[int(code)] = {"code": int(code), "name": market._short(r.get("scheme_name") or ""),
                              "sleeve": (r.get("sleeve") or "other").lower()}
    return sorted(out.values(), key=lambda f: (_SLEEVE_ORDER.get(f["sleeve"], 9), f["name"]))


def _fund_series(code: int) -> tuple[list[tuple[str, float]], Optional[float]]:
    """[(iso date, nav)] oldest → newest (mfapi history + AMFI's newer NAV, if any), and when AMFI was read."""
    from app import market, reports as R
    hist = market._fund_hist(code)
    pts = sorted(hist.items())
    amfi = R._amfi_snapshot().get(code)
    if amfi and amfi[0] and (not pts or amfi[1] > pts[-1][0]):
        pts.append((amfi[1], float(amfi[0])))
    return pts, (R._AMFI_SNAP[0] or None)


def _close_epoch(iso: str) -> int:
    """3:30 pm IST on a NAV's date — the market close the NAV is struck at."""
    y, m, d = map(int, iso.split("-"))
    return int(datetime(y, m, d, 15, 30, tzinfo=_IST).timestamp())


def funds() -> dict:
    def load():
        fl = _fund_list()
        if not fl:
            return None
        with ThreadPoolExecutor(max_workers=8) as ex:
            series = list(ex.map(lambda f: _fund_series(f["code"]), fl))
        fxs = _fx_history("INR") or []
        rate = lambda iso: _at(fxs, _close_epoch(iso)) if fxs else None
        rows = []
        for f, (pts, amfi_at) in zip(fl, series):
            if not pts:
                continue
            (ld, last), (pd, prev) = pts[-1], (pts[-2] if len(pts) > 1 else pts[-1])
            rl, rp = rate(ld), rate(pd)
            ul, up = (last / rl if rl else None), (prev / rp if rp else None)
            yr = [v for _, v in pts[-250:]]
            rows.append({
                "key": f"{FUND_PREFIX}{f['code']}", "symbol": str(f["code"]), "name": f["name"], "region": "Funds",
                "flag": "", "kind": "fund", "unit": f["sleeve"], "currency": "INR",
                "last": last, "prev_close": prev, "change": last - prev,
                "change_pct": (last / prev - 1) * 100 if prev else None,
                "usd_last": ul, "usd_prev": up, "usd_change_pct": (ul / up - 1) * 100 if ul and up else None, "fx_pct": None,
                "day_high": None, "day_low": None, "high_52w": max(yr), "low_52w": min(yr),
                "time": _close_epoch(ld), "tz": "Asia/Kolkata", "session": ld, "prev_date": pd,
                "exchange": "AMFI", "open_at": None, "close_at": None,
                "nav_date": ld, "updated": int(amfi_at) if amfi_at else None,
                "spark": [v for _, v in pts[-30:]],
            })
        return rows or None
    rows = _cached("funds", 300, load) or []
    hit = _CACHE.get("funds")
    return {"indices": rows, "as_of": int(hit[0]) if hit else int(time.time())}


def fund_history(key: str) -> Optional[dict]:
    try:
        code = int(key[len(FUND_PREFIX):])
    except ValueError:
        return None

    def load():
        pts, _ = _fund_series(code)
        if not pts:
            return None
        name = next((f["name"] for f in _fund_list() if f["code"] == code), str(code))
        fxs = _fx_history("INR") or []
        d, v, u = [], [], []
        for iso, nav in pts:
            t = _close_epoch(iso)
            r = _at(fxs, t) if fxs else None
            d.append(int(datetime.fromisoformat(iso).replace(tzinfo=ZoneInfo("UTC")).timestamp() // 86400))
            v.append(round(nav, 4))
            u.append(round(nav / r, 6) if r else None)
        return {"key": key, "name": name, "region": "Funds", "kind": "fund", "currency": "INR", "d": d, "v": v, "u": u}
    return _cached(f"h:{key}", 900, load)


# ─────────────────────────── the heat map: every market over 1W … 1Y ───────────────────────────
MOVE_DAYS = {"1w": 7, "1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 1096, "5y": 1826}


def _moves_from(pts: list[tuple[int, float]], kind: Optional[str]) -> dict:
    """{period: move} from (epoch, close) oldest → newest — % (bp for a yield) from the last close
    on or before the period's start to the latest close; YTD from the last close of last year."""
    if len(pts) < 2:
        return {}
    t_end, v_end = pts[-1]
    def from_(t0):
        base = None
        for t, v in pts:
            if t <= t0:
                base = v
            else:
                break
        # the history can start a day or two after the period's start (5Y on a 5-year fetch)
        if base is None and pts[0][0] - t0 < 7 * 86400:
            base = pts[0][1]
        if base is None:
            return None
        return round((v_end - base) * 100, 1) if kind == "yield" else round((v_end / base - 1) * 100, 3)
    out = {k: from_(t_end - d * 86400) for k, d in MOVE_DAYS.items()}
    y0 = int(datetime(datetime.utcfromtimestamp(t_end).year, 1, 1, tzinfo=ZoneInfo("UTC")).timestamp()) - 1
    out["ytd"] = from_(y0)
    return out


def _fx_walk(pts: list, fx: list, mul: bool = False) -> list:
    """Closes converted at each day's rate (÷ local-per-US$ → US$; × with mul) — one pass, both series in time order."""
    out, j = [], 0
    for t, v in pts:
        while j + 1 < len(fx) and fx[j + 1][0] <= t:
            j += 1
        r = fx[j][1] if fx else None
        if r:
            out.append((t, v * r if mul else v / r))
    return out


def moves() -> dict:
    """Every market's (and fund's) move over 1W … 5Y and YTD — the heat map. `moves` in its own
    currency (rupees for the ₹-viewed commodities, as their 1D is), `usd` in US DOLLARS: each close
    ÷ that day's rate, so a currency's fall shows in the move (Nifty +10% with the rupee −5% ≈ +4.8%).
    Currencies (already vs US$) and yields (bp) are the same in both."""
    def load():
        syms = [x["symbol"] for x in INDICES]
        chunks = [syms[i:i + 10] for i in range(0, len(syms), 10)]
        got: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=8) as ex:
            for g in ex.map(lambda c: _spark(c, "5y", "1d"), chunks):
                got.update(g)
        out, usd = {}, {}
        for ix in INDICES:
            res = got.get(ix["symbol"])
            if not res:
                continue
            pts = _points(res)
            if c := _contract(ix["symbol"]):    # a future: the current contract's own closes
                pts = _splice(pts, _points(_get(c, "5y", "1d") or {}))
            pts = [(t, v) for t, v in pts]
            kind, ccy = ix.get("kind"), (res.get("meta") or {}).get("currency")
            own = mv = _moves_from(pts, kind)
            if kind not in ("fx", "yield"):
                if ccy in FX:                     # a local-currency market → US$
                    fx = _fx_history(ccy)
                    mv = _moves_from(_fx_walk(pts, fx), kind) if fx else {}
                elif ccy == "USD" and ix.get("local") in FX:   # a US$ commodity viewed in rupees
                    fx = _fx_history(ix["local"])
                    own = _moves_from(_fx_walk(pts, fx, mul=True), kind) if fx else own
            out[ix["key"]], usd[ix["key"]] = own, mv
        fl = _fund_list()
        with ThreadPoolExecutor(max_workers=8) as ex:
            series = list(ex.map(lambda f: _fund_series(f["code"])[0], fl))
        inr = _fx_history("INR") or []
        for f, pts in zip(fl, series):
            p = [(_close_epoch(d), v) for d, v in pts]
            out[f"{FUND_PREFIX}{f['code']}"] = _moves_from(p, None)
            usd[f"{FUND_PREFIX}{f['code']}"] = _moves_from(_fx_walk(p, inr), None) if inr else {}
        return {"local": out, "usd": usd} if out else None
    got = _cached("moves6", 900, load) or {}
    return {"moves": got.get("local") or {}, "usd": got.get("usd") or {}}
