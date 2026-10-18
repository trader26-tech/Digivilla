"""Global markets — the admin's world-markets screen.

Everything comes from Yahoo Finance's public chart/spark APIs (no key), fetched on the
server in batches and cached, so the page never hammers it:

  snapshot()      every instrument at once: last price, the TRUE previous close (the last
                  close of a session before the one the latest price belongs to), the day's
                  move, and 1W / 1M / 3M / YTD / 1Y / 3Y / 5Y moves — in its own currency, in
                  US dollars and in rupees — plus a one-month sparkline. Two Yahoo datasets:
                  a year of DAILY closes (cached 90 s) and five years of WEEKLY closes (6 h).
  history(key)    one instrument's daily closes since 2000 in its own currency, US$ and ₹
                  (cached 6 h) — the compare chart slices any window from it.

The universe:
  • MSCI headline indices — the OFFICIAL MSCI ACWI / World / EM / EAFE levels (US$, price)
  • all 47 MSCI ACWI countries (23 developed, 24 emerging): the country's own benchmark
    index (local currency), its currency against the US$, and — where one exists — the
    iShares/Global X MSCI country ETF (US$), which tracks MSCI's own country index
  • commodities (energy, precious & industrial metals, agriculture) in US$ and ₹
  • every ACWI currency against the US$ (and the rupee), the US$ index (DXY)
  • US Treasury yields and the VIX
If Yahoo refuses (rate limit), the last good copy is served.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

_UA = {"User-Agent": "Mozilla/5.0"}       # Yahoo answers a plain UA; a full browser UA without cookies gets 429
_CACHE: dict = {}
_LOCK = threading.Lock()

# ─────────────────────────────── the universe ───────────────────────────────
# MSCI's official index levels (US$, price return)
MSCI = [
    {"key": "msci_acwi", "symbol": "^892400-USD-STRD", "name": "MSCI ACWI", "about": "All Country World — 47 developed + emerging markets", "etf": "ACWI"},
    {"key": "msci_world", "symbol": "^990100-USD-STRD", "name": "MSCI World", "about": "23 developed markets", "etf": "URTH"},
    {"key": "msci_em", "symbol": "^891800-USD-STRD", "name": "MSCI Emerging Markets", "about": "24 emerging markets", "etf": "EEM"},
    {"key": "msci_eafe", "symbol": "^990300-USD-STRD", "name": "MSCI EAFE", "about": "Developed markets outside the US & Canada", "etf": "EFA"},
]

# iso, name, flag, MSCI class, region, currency, local benchmark (symbol, name), MSCI country ETF (US$)
_C = [
    # ── developed: Americas
    ("US", "United States", "🇺🇸", "DM", "Americas", "USD", "^GSPC", "S&P 500", None),
    ("CA", "Canada", "🇨🇦", "DM", "Americas", "CAD", "^GSPTSE", "S&P/TSX Composite", "EWC"),
    # ── developed: Europe & Middle East
    ("GB", "United Kingdom", "🇬🇧", "DM", "Europe", "GBP", "^FTSE", "FTSE 100", "EWU"),
    ("FR", "France", "🇫🇷", "DM", "Europe", "EUR", "^FCHI", "CAC 40", "EWQ"),
    ("DE", "Germany", "🇩🇪", "DM", "Europe", "EUR", "^GDAXI", "DAX", "EWG"),
    ("CH", "Switzerland", "🇨🇭", "DM", "Europe", "CHF", "^SSMI", "SMI", "EWL"),
    ("NL", "Netherlands", "🇳🇱", "DM", "Europe", "EUR", "^AEX", "AEX", "EWN"),
    ("SE", "Sweden", "🇸🇪", "DM", "Europe", "SEK", "^OMX", "OMX Stockholm 30", "EWD"),
    ("DK", "Denmark", "🇩🇰", "DM", "Europe", "DKK", "^OMXC25", "OMX Copenhagen 25", "EDEN"),
    ("IT", "Italy", "🇮🇹", "DM", "Europe", "EUR", "FTSEMIB.MI", "FTSE MIB", "EWI"),
    ("ES", "Spain", "🇪🇸", "DM", "Europe", "EUR", "^IBEX", "IBEX 35", "EWP"),
    ("FI", "Finland", "🇫🇮", "DM", "Europe", "EUR", "^OMXH25", "OMX Helsinki 25", "EFNL"),
    ("BE", "Belgium", "🇧🇪", "DM", "Europe", "EUR", "^BFX", "BEL 20", "EWK"),
    ("NO", "Norway", "🇳🇴", "DM", "Europe", "NOK", "OSEBX.OL", "Oslo Børs Benchmark", "ENOR"),
    ("IE", "Ireland", "🇮🇪", "DM", "Europe", "EUR", "^ISEQ", "ISEQ All Share", "EIRL"),
    ("AT", "Austria", "🇦🇹", "DM", "Europe", "EUR", "^ATX", "ATX", "EWO"),
    ("PT", "Portugal", "🇵🇹", "DM", "Europe", "EUR", "PSI20.LS", "PSI", None),
    ("IL", "Israel", "🇮🇱", "DM", "Europe", "ILS", "TA35.TA", "TA-35", "EIS"),
    # ── developed: Pacific
    ("JP", "Japan", "🇯🇵", "DM", "Asia Pacific", "JPY", "^N225", "Nikkei 225", "EWJ"),
    ("AU", "Australia", "🇦🇺", "DM", "Asia Pacific", "AUD", "^AXJO", "S&P/ASX 200", "EWA"),
    ("HK", "Hong Kong", "🇭🇰", "DM", "Asia Pacific", "HKD", "^HSI", "Hang Seng", "EWH"),
    ("SG", "Singapore", "🇸🇬", "DM", "Asia Pacific", "SGD", "^STI", "Straits Times", "EWS"),
    ("NZ", "New Zealand", "🇳🇿", "DM", "Asia Pacific", "NZD", "^NZ50", "S&P/NZX 50", "ENZL"),
    # ── emerging: Asia
    ("CN", "China", "🇨🇳", "EM", "Asia Pacific", "CNY", "000001.SS", "Shanghai Composite", "MCHI"),
    ("IN", "India", "🇮🇳", "EM", "Asia Pacific", "INR", "^NSEI", "Nifty 50", "INDA"),
    ("TW", "Taiwan", "🇹🇼", "EM", "Asia Pacific", "TWD", "^TWII", "TAIEX", "EWT"),
    ("KR", "South Korea", "🇰🇷", "EM", "Asia Pacific", "KRW", "^KS11", "KOSPI", "EWY"),
    ("ID", "Indonesia", "🇮🇩", "EM", "Asia Pacific", "IDR", "^JKSE", "IDX Composite", "EIDO"),
    ("TH", "Thailand", "🇹🇭", "EM", "Asia Pacific", "THB", "^SET.BK", "SET", "THD"),
    ("MY", "Malaysia", "🇲🇾", "EM", "Asia Pacific", "MYR", "^KLSE", "FTSE Bursa KLCI", "EWM"),
    ("PH", "Philippines", "🇵🇭", "EM", "Asia Pacific", "PHP", "PSEI.PS", "PSEi", "EPHE"),
    # ── emerging: Americas
    ("BR", "Brazil", "🇧🇷", "EM", "Americas", "BRL", "^BVSP", "Ibovespa", "EWZ"),
    ("MX", "Mexico", "🇲🇽", "EM", "Americas", "MXN", "^MXX", "IPC", "EWW"),
    ("CL", "Chile", "🇨🇱", "EM", "Americas", "CLP", "SPIPSA.SN", "S&P IPSA", "ECH"),
    ("CO", "Colombia", "🇨🇴", "EM", "Americas", "COP", "^SPCOSLCP", "S&P Colombia Select", None),
    ("PE", "Peru", "🇵🇪", "EM", "Americas", "PEN", None, None, "EPU"),
    # ── emerging: Europe, Middle East & Africa
    ("SA", "Saudi Arabia", "🇸🇦", "EM", "Middle East & Africa", "SAR", "^TASI.SR", "Tadawul All Share", "KSA"),
    ("ZA", "South Africa", "🇿🇦", "EM", "Middle East & Africa", "ZAR", "^J203.JO", "JSE All Share", "EZA"),
    ("AE", "UAE", "🇦🇪", "EM", "Middle East & Africa", "AED", "FADGI.FGI", "FTSE ADX General", "UAE"),
    ("QA", "Qatar", "🇶🇦", "EM", "Middle East & Africa", "QAR", "^GNRI.QA", "QE Index", "QAT"),
    ("KW", "Kuwait", "🇰🇼", "EM", "Middle East & Africa", "KWD", None, None, "KWT"),
    ("EG", "Egypt", "🇪🇬", "EM", "Middle East & Africa", "EGP", "^CASE30", "EGX 30", None),
    ("TR", "Turkey", "🇹🇷", "EM", "Europe", "TRY", "XU100.IS", "BIST 100", "TUR"),
    ("PL", "Poland", "🇵🇱", "EM", "Europe", "PLN", "WIG20.WA", "WIG20", "EPOL"),
    ("GR", "Greece", "🇬🇷", "EM", "Europe", "EUR", "GD.AT", "Athens General", "GREK"),
    ("HU", "Hungary", "🇭🇺", "EM", "Europe", "HUF", "^BUX.BD", "BUX", None),
    ("CZ", "Czech Republic", "🇨🇿", "EM", "Europe", "CZK", "FPXAA.PR", "PX", None),
]
COUNTRIES = [{"iso": c[0], "name": c[1], "flag": c[2], "cls": c[3], "region": c[4], "ccy": c[5],
              "index": c[6], "index_name": c[7], "etf": c[8]} for c in _C]

# commodities: Yahoo front-month futures; USX = US cents (shown as US$)
COMMODITIES = [
    {"key": "brent", "symbol": "BZ=F", "name": "Brent crude", "group": "Energy", "unit": "/bbl"},
    {"key": "wti", "symbol": "CL=F", "name": "WTI crude", "group": "Energy", "unit": "/bbl"},
    {"key": "natgas", "symbol": "NG=F", "name": "Natural gas", "group": "Energy", "unit": "/MMBtu"},
    {"key": "gasoline", "symbol": "RB=F", "name": "Gasoline (RBOB)", "group": "Energy", "unit": "/gal"},
    {"key": "heatoil", "symbol": "HO=F", "name": "Heating oil", "group": "Energy", "unit": "/gal"},
    {"key": "gold", "symbol": "GC=F", "name": "Gold", "group": "Precious metals", "unit": "/oz"},
    {"key": "silver", "symbol": "SI=F", "name": "Silver", "group": "Precious metals", "unit": "/oz"},
    {"key": "platinum", "symbol": "PL=F", "name": "Platinum", "group": "Precious metals", "unit": "/oz"},
    {"key": "palladium", "symbol": "PA=F", "name": "Palladium", "group": "Precious metals", "unit": "/oz"},
    {"key": "copper", "symbol": "HG=F", "name": "Copper", "group": "Industrial metals", "unit": "/lb"},
    {"key": "aluminium", "symbol": "ALI=F", "name": "Aluminium", "group": "Industrial metals", "unit": "/t"},
    {"key": "wheat", "symbol": "ZW=F", "name": "Wheat", "group": "Agriculture", "unit": "/bu"},
    {"key": "corn", "symbol": "ZC=F", "name": "Corn", "group": "Agriculture", "unit": "/bu"},
    {"key": "soybeans", "symbol": "ZS=F", "name": "Soybeans", "group": "Agriculture", "unit": "/bu"},
    {"key": "coffee", "symbol": "KC=F", "name": "Coffee", "group": "Agriculture", "unit": "/lb"},
    {"key": "sugar", "symbol": "SB=F", "name": "Sugar", "group": "Agriculture", "unit": "/lb"},
    {"key": "cocoa", "symbol": "CC=F", "name": "Cocoa", "group": "Agriculture", "unit": "/t"},
    {"key": "cotton", "symbol": "CT=F", "name": "Cotton", "group": "Agriculture", "unit": "/lb"},
    {"key": "cattle", "symbol": "LE=F", "name": "Live cattle", "group": "Agriculture", "unit": "/lb"},
]
CCY_NAMES = {
    "INR": "Indian rupee", "CNY": "Chinese yuan", "JPY": "Japanese yen", "EUR": "Euro", "GBP": "British pound",
    "CHF": "Swiss franc", "CAD": "Canadian dollar", "AUD": "Australian dollar", "NZD": "New Zealand dollar",
    "HKD": "Hong Kong dollar", "SGD": "Singapore dollar", "KRW": "South Korean won", "TWD": "Taiwan dollar",
    "IDR": "Indonesian rupiah", "THB": "Thai baht", "MYR": "Malaysian ringgit", "PHP": "Philippine peso",
    "SEK": "Swedish krona", "NOK": "Norwegian krone", "DKK": "Danish krone", "ILS": "Israeli shekel",
    "BRL": "Brazilian real", "MXN": "Mexican peso", "CLP": "Chilean peso", "COP": "Colombian peso", "PEN": "Peruvian sol",
    "SAR": "Saudi riyal", "AED": "UAE dirham", "QAR": "Qatari riyal", "KWD": "Kuwaiti dinar", "EGP": "Egyptian pound",
    "ZAR": "South African rand", "TRY": "Turkish lira", "PLN": "Polish złoty", "HUF": "Hungarian forint", "CZK": "Czech koruna",
}
# a currency's flag: the biggest market that uses it
CCY_FLAG = {c["ccy"]: c["flag"] for c in reversed(COUNTRIES)} | {"EUR": "🇪🇺", "USD": "🇺🇸"}
PEGGED = {"HKD", "SAR", "AED", "QAR"}            # held to the US$ by the central bank
GAUGES = [
    {"key": "dxy", "symbol": "DX-Y.NYB", "name": "US dollar index", "about": "The US$ against six major currencies", "kind": "level"},
    {"key": "vix", "symbol": "^VIX", "name": "VIX", "about": "Expected S&P 500 volatility — the market's fear gauge", "kind": "level"},
    {"key": "us3m", "symbol": "^IRX", "name": "US 3-month T-bill", "about": "Yield, % a year", "kind": "yield"},
    {"key": "us5y", "symbol": "^FVX", "name": "US 5-year Treasury", "about": "Yield, % a year", "kind": "yield"},
    {"key": "us10y", "symbol": "^TNX", "name": "US 10-year Treasury", "about": "Yield, % a year", "kind": "yield"},
    {"key": "us30y", "symbol": "^TYX", "name": "US 30-year Treasury", "about": "Yield, % a year", "kind": "yield"},
]


def _instruments() -> list[dict]:
    """Every instrument with a stable key, its Yahoo symbol and what it is."""
    out = []
    for m in MSCI:
        out.append({"key": m["key"], "symbol": m["symbol"], "type": "msci", "name": m["name"], "ccy": "USD", "about": m["about"]})
    for c in COUNTRIES:
        if c["index"]:
            out.append({"key": "idx:" + c["iso"], "symbol": c["index"], "type": "index", "name": c["index_name"],
                        "country": c["iso"], "ccy": c["ccy"]})
        if c["etf"]:
            out.append({"key": "etf:" + c["iso"], "symbol": c["etf"], "type": "etf", "name": f"MSCI {c['name']} (ETF {c['etf']})",
                        "country": c["iso"], "ccy": "USD"})
    for m in MSCI:
        out.append({"key": "etf:" + m["key"], "symbol": m["etf"], "type": "etf", "name": f"{m['name']} (ETF {m['etf']})", "ccy": "USD"})
    for k in COMMODITIES:
        out.append({"key": "cmd:" + k["key"], "symbol": k["symbol"], "type": "commodity", "name": k["name"], "ccy": "USD",
                    "group": k["group"], "unit": k["unit"]})
    for ccy in sorted({c["ccy"] for c in COUNTRIES} - {"USD"}):
        out.append({"key": "fx:" + ccy, "symbol": f"{ccy}=X", "type": "fx", "name": CCY_NAMES.get(ccy, ccy), "ccy": ccy})
    for g in GAUGES:
        out.append({"key": g["key"], "symbol": g["symbol"], "type": g["kind"], "name": g["name"], "ccy": "USD", "about": g["about"]})
    return out


INSTRUMENTS = _instruments()
_BY_KEY = {i["key"]: i for i in INSTRUMENTS}


# ─────────────────────────────── Yahoo ───────────────────────────────
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


def _spark(symbols: list[str], rng: str, interval: str) -> dict[str, dict]:
    """One batched request for up to ~10 symbols → {symbol: chart response}."""
    url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols="
           + ",".join(quote(s) for s in symbols) + f"&range={rng}&interval={interval}")
    for attempt in range(2):
        try:
            r = httpx.get(url, headers=_UA, timeout=25)
            if r.status_code == 200:
                out = {}
                for x in (r.json().get("spark") or {}).get("result") or []:
                    resp = (x.get("response") or [None])[0]
                    if resp:
                        out[x.get("symbol")] = resp
                return out
        except Exception:
            pass
        time.sleep(0.6)
    return {}


def _chart(symbol: str, rng: str, interval: str) -> Optional[dict]:
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
           f"?range={rng}&interval={interval}&includePrePost=false")
    try:
        r = httpx.get(url, headers=_UA, timeout=25)
        if r.status_code == 200:
            res = (r.json().get("chart") or {}).get("result") or []
            return res[0] if res else None
    except Exception:
        pass
    return None


def _batch(symbols: list[str], rng: str, interval: str) -> dict[str, dict]:
    chunks = [symbols[i:i + 10] for i in range(0, len(symbols), 10)]
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for got in ex.map(lambda c: _spark(c, rng, interval), chunks):
            out.update(got)
    return out


def _closes(res: dict) -> list[tuple[int, float]]:
    """[(unix time, close)] with gaps dropped."""
    ts = res.get("timestamp") or []
    cl = (((res.get("indicators") or {}).get("quote") or [{}])[0].get("close")) or []
    return [(t, c) for t, c in zip(ts, cl) if c is not None]


def _tz(m: dict) -> ZoneInfo:
    try:
        return ZoneInfo(m.get("exchangeTimezoneName") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _daykey(t: int, tz: ZoneInfo) -> str:
    return datetime.fromtimestamp(t, tz).date().isoformat()


def _series(res: dict) -> dict:
    """A symbol's closes by exchange-local date, its latest price and the date it belongs to."""
    m = res.get("meta") or {}
    tz = _tz(m)
    by_day: dict[str, float] = {}
    for t, c in _closes(res):
        k = _daykey(t, tz)
        if datetime.fromisoformat(k).weekday() < 5:          # weekend bars are stale repeats (MSCI's series has them)
            by_day[k] = c
    last = m.get("regularMarketPrice")
    session = _daykey(m["regularMarketTime"], tz) if m.get("regularMarketTime") else (max(by_day) if by_day else None)
    # MSCI's regularMarketTime is the fetch time, not a session: a weekend "session" is the last weekday bar
    if session and datetime.fromisoformat(session).weekday() >= 5:
        session = max((d for d in by_day if d <= session), default=session)
    if last is not None and session:
        by_day[session] = last                     # the latest price is the session's close so far
    days = sorted(by_day)
    return {"days": days, "vals": [by_day[d] for d in days], "last": last, "session": session,
            "time": m.get("regularMarketTime"), "currency": m.get("currency"),
            "high": m.get("regularMarketDayHigh"), "low": m.get("regularMarketDayLow"),
            "meta_prev": m.get("previousClose") or m.get("chartPreviousClose"),
            "name": m.get("longName") or m.get("shortName")}


def _at(days: list[str], vals: list[float], day: str) -> Optional[float]:
    """The close on or before `day` (None if the series starts after it)."""
    lo, hi, ans = 0, len(days) - 1, -1
    while lo <= hi:
        mid = (lo + hi) >> 1
        if days[mid] <= day:
            ans, lo = mid, mid + 1
        else:
            hi = mid - 1
    return vals[ans] if ans >= 0 else None


PERIODS = ["1d", "1w", "1m", "3m", "ytd", "1y", "3y", "5y"]


def _starts(session: str) -> dict[str, str]:
    d = datetime.fromisoformat(session).date()
    back = lambda **kw: (d - timedelta(**kw)).isoformat()
    def years(n):
        try:
            return d.replace(year=d.year - n).isoformat()
        except ValueError:
            return d.replace(year=d.year - n, day=28).isoformat()
    return {"1w": back(days=7), "1m": back(days=30), "3m": back(days=91), "ytd": f"{d.year - 1}-12-31",
            "1y": years(1), "3y": years(3), "5y": years(5)}


def _moves(s: dict, wk: Optional[dict]) -> dict[str, Optional[float]]:
    """% moves for every period (from the start's close on or before that day). 1D = vs the
    last close of an EARLIER session; 3Y/5Y from the weekly series."""
    out: dict[str, Optional[float]] = {p: None for p in PERIODS}
    days, vals, last, session = s["days"], s["vals"], s["last"], s["session"]
    if last is None or not session or not days:
        return out
    prev = None
    for d, v in zip(reversed(days), reversed(vals)):
        if d < session:
            prev = v
            break
    if prev is None and len(days) < 5:
        prev = s.get("meta_prev")                  # a quote with no history: Yahoo's own previous close
    out["1d"] = (last / prev - 1) * 100 if prev else None
    out["_prev"] = prev
    if len(days) < 5:
        return out                                 # no history behind the quote: today only
    for p, start in _starts(session).items():
        src = (wk["days"], wk["vals"]) if p in ("3y", "5y") and wk else (days, vals)
        if not src[0]:
            continue
        if src[0][0] > start:                       # starts after the window opened: allow a few days' slack only
            if (datetime.fromisoformat(src[0][0]) - datetime.fromisoformat(start)).days > 10:
                continue
            start = src[0][0]
        a = _at(src[0], src[1], start)
        out[p] = (last / a - 1) * 100 if a else None
    return out


def _fx_moves(rate: dict) -> dict:
    """For a <ccy>=X series (units per US$): % moves of the CURRENCY against the US$
    (+ = it strengthened), from the rate's own % moves."""
    return {p: (None if v is None else (1 / (1 + v / 100) - 1) * 100) for p, v in rate.items() if not p.startswith("_")}


def _combine(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return None if a is None or b is None else ((1 + a / 100) * (1 + b / 100) - 1) * 100


def _spark_of(s: dict, n: int = 23) -> list[float]:
    return [round(v, 6) for v in s["vals"][-n:]]


def _msci_row(m: dict, q: dict) -> dict:
    """An MSCI headline index: the official level; any period Yahoo has no history for is
    taken from the iShares ETF that tracks it (US$, price) and marked so."""
    row, etf = dict(q[m["key"]]), q.get("etf:" + m["key"]) or {}
    src = {}
    for basis in ("usd", "inr", "local"):
        merged = {}
        for p in PERIODS:
            v = (row.get(basis) or {}).get(p)
            if v is None and etf.get("ok"):
                v = (etf.get(basis) or {}).get(p)
                if v is not None:
                    src[p] = "etf"
            else:
                src.setdefault(p, "index" if v is not None else None)
            merged[p] = v
        row[basis] = merged
    if len(row.get("spark") or []) < 3 and etf.get("spark"):
        row["spark"] = etf["spark"]                 # MSCI's series is thin on Yahoo: the ETF's month draws the line
    return {**m, **row, "src": src, "q_etf": etf}


def snapshot() -> dict:
    def load():
        syms = sorted({i["symbol"] for i in INSTRUMENTS})
        daily = _batch(syms, "2y", "1d")
        if len(daily) < len(syms) * 0.6:
            return None                                       # Yahoo mostly refused: keep the last copy
        # a few symbols (MSCI EM / EAFE) come back from the batch with one point: fetch those alone
        thin = [sym for sym in syms if len(_closes(daily.get(sym) or {})) < 5]
        if thin:
            with ThreadPoolExecutor(max_workers=4) as ex:
                for sym, res in zip(thin, ex.map(lambda x: _chart(x, "2y", "1d"), thin)):
                    if res:
                        daily[sym] = res
        def weekly_load():
            w = _batch(syms, "10y", "1wk")
            thin_w = [sym for sym in syms if len(_closes(w.get(sym) or {})) < 5]
            for sym in thin_w:
                res = _chart(sym, "10y", "1wk")
                if res:
                    w[sym] = res
            return w or None
        weekly = _cached("gm:weekly", 6 * 3600, weekly_load) or {}
        S = {sym: _series(res) for sym, res in daily.items()}
        W = {sym: _series(res) for sym, res in weekly.items()}

        def moves(sym):
            return _moves(S[sym], W.get(sym)) if sym in S else {p: None for p in PERIODS}

        fx: dict[str, dict] = {}                              # currency vs US$, + = currency up
        for ccy in {c["ccy"] for c in COUNTRIES} - {"USD"}:
            fx[ccy] = _fx_moves(moves(f"{ccy}=X"))
            # a pegged currency doesn't move 1% in a day: a print like that is a bad tick in Yahoo's feed
            if ccy in PEGGED:
                for p_ in ("1d", "1w"):
                    if fx[ccy].get(p_) is not None and abs(fx[ccy][p_]) > 1.0:
                        fx[ccy][p_] = None
        fx["USD"] = {p: 0.0 for p in PERIODS}
        inr = fx["INR"]
        # a US$ return seen from India: the rupee falling against the US$ ADDS to it
        to_inr = lambda usd: {p: (None if usd.get(p) is None or inr.get(p) is None
                                  else ((1 + usd[p] / 100) / (1 + inr[p] / 100) - 1) * 100) for p in PERIODS}

        def quote_of(i: dict) -> dict:
            s = S.get(i["symbol"])
            if not s:
                return {"key": i["key"], "ok": False}
            mv = moves(i["symbol"])
            scale = 0.01 if s["currency"] == "USX" else 1.0      # US cents → US$
            loc = {p: mv.get(p) for p in PERIODS}
            ccy = i["ccy"]
            usd = loc if ccy == "USD" else {p: _combine(loc[p], fx.get(ccy, {}).get(p)) for p in PERIODS}
            yld = i["type"] == "yield"
            row = {
                "key": i["key"], "ok": True, "last": s["last"] * scale if s["last"] is not None else None,
                "prev": (mv.get("_prev") or 0) * scale or None, "session": s["session"], "time": s["time"],
                "high": (s["high"] or 0) * scale or None, "low": (s["low"] or 0) * scale or None,
                "hi52": max(s["vals"][-252:]) * scale if s["vals"] else None, "lo52": min(s["vals"][-252:]) * scale if s["vals"] else None,
                "local": loc, "usd": usd, "inr": to_inr(usd) if not yld else None,
                "spark": [v * scale for v in _spark_of(s)],
            }
            if yld and s["last"] is not None and mv.get("_prev"):
                row["bp"] = round((s["last"] - mv["_prev"]) * 100, 1)
            return row

        q = {i["key"]: quote_of(i) for i in INSTRUMENTS}
        # currencies: the rate per US$, and the currency's move vs US$ and vs ₹
        currencies = []
        for ccy in sorted({c["ccy"] for c in COUNTRIES} - {"USD"}, key=lambda c: CCY_NAMES.get(c, c)):
            s = S.get(f"{ccy}=X")
            if not s:
                continue
            vs_usd = fx[ccy]
            suspect = ccy in PEGGED and vs_usd.get("1d") is None
            vs_inr = {p: (None if vs_usd[p] is None or inr[p] is None else ((1 + vs_usd[p] / 100) / (1 + inr[p] / 100) - 1) * 100)
                      for p in PERIODS}
            inr_rate = S.get("INR=X")
            currencies.append({
                "ccy": ccy, "name": CCY_NAMES.get(ccy, ccy), "flag": CCY_FLAG.get(ccy, "🏳️"), "pegged": ccy in PEGGED, "suspect": suspect,
                "per_usd": s["last"], "per_inr": (s["last"] / inr_rate["last"]) if inr_rate and inr_rate["last"] else None,
                "inr_per": (inr_rate["last"] / s["last"]) if inr_rate and s["last"] else None,
                "vs_usd": vs_usd, "vs_inr": vs_inr, "session": s["session"],
                "spark": [1 / v for v in _spark_of(s) if v],     # the currency's value in US$ — down = it weakened
            })
        # one performance line per country: its own index where Yahoo has the history, else the
        # MSCI country ETF (US$) — converted back to local terms through the currency — per period
        countries = []
        for c in COUNTRIES:
            qi = q.get("idx:" + c["iso"]) if c["index"] else None
            qe = q.get("etf:" + c["iso"]) if c["etf"] else None
            f = fx.get(c["ccy"]) or {}
            perf = {"local": {}, "usd": {}, "inr": {}, "src": {}}
            for p in PERIODS:
                src = None
                if qi and qi.get("ok") and qi["local"].get(p) is not None and (c["ccy"] == "USD" or qi["usd"].get(p) is not None):
                    loc, usd, src = qi["local"][p], qi["usd"][p], "index"
                elif qe and qe.get("ok") and qe["usd"].get(p) is not None:
                    usd, src = qe["usd"][p], "etf"
                    loc = None if f.get(p) is None else ((1 + usd / 100) / (1 + f[p] / 100) - 1) * 100
                else:
                    loc = usd = None
                perf["local"][p], perf["usd"][p], perf["src"][p] = loc, usd, src
                perf["inr"][p] = (None if usd is None or inr.get(p) is None
                                  else ((1 + usd / 100) / (1 + inr[p] / 100) - 1) * 100)
            countries.append({**c, "q_index": qi, "q_etf": qe, "fx": f, "perf": perf})
        return {
            "as_of": int(time.time()),
            "periods": PERIODS,
            "msci": [_msci_row(m, q) for m in MSCI],
            "countries": countries,
            "commodities": [{**q["cmd:" + k["key"]], **k} for k in COMMODITIES],   # keeps key = "brent", not "cmd:brent"
            "currencies": currencies,
            "gauges": [{**g, **q[g["key"]]} for g in GAUGES],
            "instruments": [{k: i[k] for k in ("key", "type", "name", "ccy") if k in i}
                            | ({"country": i["country"]} if "country" in i else {})
                            | ({"group": i["group"], "unit": i["unit"]} if "group" in i else {}) for i in INSTRUMENTS],
        }
    return _cached("gm:snapshot", 90, load) or {"as_of": None, "periods": PERIODS, "msci": [], "countries": [],
                                                  "commodities": [], "currencies": [], "gauges": [], "instruments": []}


# ─────────────────────────────── history (compare chart) ───────────────────────────────
_FROM = 946684800      # 1 Jan 2000


def _daily_full(symbol: str) -> Optional[dict]:
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
           f"?period1={_FROM}&period2={int(time.time()) + 86400}&interval=1d&includePrePost=false")
    for _ in range(2):
        try:
            r = httpx.get(url, headers=_UA, timeout=30)
            if r.status_code == 200:
                res = (r.json().get("chart") or {}).get("result") or []
                return res[0] if res else None
        except Exception:
            pass
        time.sleep(0.6)
    return None


def _day_map(symbol: str) -> Optional[dict[int, float]]:
    """{day number (days since 1970, exchange-local date): close} since 2000, cached 6 h."""
    def load():
        res = _daily_full(symbol)
        if not res:
            return None
        tz = _tz(res.get("meta") or {})
        out: dict[int, float] = {}
        for t, c in _closes(res):
            d = datetime.fromtimestamp(t, tz).date()
            if d.weekday() < 5:
                out[(d - datetime(1970, 1, 1).date()).days] = c
        m = res.get("meta") or {}
        if m.get("regularMarketPrice") is not None and m.get("regularMarketTime"):
            d = datetime.fromtimestamp(m["regularMarketTime"], tz).date()
            if d.weekday() < 5:
                out[(d - datetime(1970, 1, 1).date()).days] = m["regularMarketPrice"]
        return {"map": out, "currency": m.get("currency")}
    return _cached(f"gm:h:{symbol}", 6 * 3600, load)


def _carry(days: list[int], m: dict[int, float]):
    """Look up m on each day, carrying the last value over gaps."""
    ks = sorted(m)
    j, last, out = 0, None, []
    for d in days:
        while j < len(ks) and ks[j] <= d:
            last = m[ks[j]]
            j += 1
        out.append(last)
    return out


def history(key: str) -> Optional[dict]:
    """Daily closes since 2000: d = day numbers, v = own currency, u = US$, r = ₹.
    A currency's series is its VALUE (US$ per unit; ₹ per unit) — so a weakening currency falls."""
    i = _BY_KEY.get(key)
    if not i:
        return None

    def load():
        h = _day_map(i["symbol"])
        if not h:
            return None
        m = h["map"]
        if h["currency"] == "USX":
            m = {d: v / 100 for d, v in m.items()}
        days = sorted(m)
        inr = _day_map("INR=X")
        if not inr:
            return None
        inr_v = _carry(days, inr["map"])
        if i["type"] == "fx":
            v = [1 / m[d] for d in days]                         # US$ per unit
            u = v
            r = [(x * k) if k else None for x, k in zip(v, inr_v)]   # ₹ per unit
            return {"key": key, "name": i["name"], "type": "fx", "currency": i["ccy"], "d": days, "v": v, "u": u, "r": r}
        ccy = i["ccy"]
        v = [m[d] for d in days]
        if ccy == "USD" or i["type"] in ("yield",):
            u = v
        else:
            fxh = _day_map(f"{ccy}=X")
            if not fxh:
                return None
            fx_v = _carry(days, fxh["map"])
            u = [(x / f) if f else None for x, f in zip(v, fx_v)]
        r = None if i["type"] == "yield" else [(x * k) if x is not None and k else None for x, k in zip(u, inr_v)]
        return {"key": key, "name": i["name"], "type": i["type"], "currency": ccy, "d": days, "v": v, "u": u, "r": r}
    return _cached(f"gm:hist:{key}", 6 * 3600, load)
