"""Markets today — the admin's India-first market board.

One payload for the page, for one range (1d · 1w · 1m · 3m · ytd · 1y):

  items    the Indian indices (Nifty 50, Nifty 100, Midcap 150, Smallcap 250, Nifty 500),
           Gold BeES, the Nifty 50 Arbitrage index, the rupee against the US$, the US 10-year
           yield and the S&P 500 — each with its level, the move over the range, today's move,
           and the series over the range as % from the range's base (for the chart).
  villas   the three villas from calc_config, replayed over the same range as a fixed-weight
           basket of their parts (Nifty 50 Arbitrage · Gold BeES · Nifty 50 · Midcap 150 ·
           Smallcap 250) — WITH gold (as configured) and WITHOUT gold (gold's share split
           equally into large / mid / small). Within a day that is exactly what the villa does;
           over longer ranges it is the parts held from the start of the window, no rebalance.

Series come from Yahoo's chart API (5-minute bars for 1D, 30-minute for 1W, daily beyond), the
Indian indices' day numbers are overridden by NSE's own board when it has the same session, and
the arbitrage index (not on Yahoo, not on NSE's live board) comes from the stored daily closes
(app.market) and is marked as such. Previous closes are taken from the DAILY bars (Yahoo's
chartPreviousClose is unreliable for Indian indices), as app.world does.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app import market as market_svc
from app.calc_settings import calc_config
from app.globalmkts import _at, _cached, _chart, _closes, _daykey, _day_map, _spark, _tz

# key, Yahoo symbol, name, short name, group, kind
ITEMS = [
    {"key": "nifty50", "symbol": "^NSEI", "name": "Nifty 50", "short": "Nifty 50", "group": "India", "kind": "index",
     "about": "The 50 largest companies — the villas' large-cap part"},
    {"key": "n100", "symbol": "^CNX100", "name": "Nifty 100 · Large cap", "short": "Large cap", "group": "India", "kind": "index",
     "about": "The 100 largest companies (large caps)"},
    {"key": "mid", "symbol": "NIFTYMIDCAP150.NS", "name": "Nifty Midcap 150", "short": "Mid cap", "group": "India", "kind": "index",
     "about": "Companies ranked 101–250 — the villas' mid-cap part"},
    {"key": "small", "symbol": "NIFTYSMLCAP250.NS", "name": "Nifty Smallcap 250", "short": "Small cap", "group": "India", "kind": "index",
     "about": "Companies ranked 251–500 — the villas' small-cap part"},
    {"key": "n500", "symbol": "^CRSLDX", "name": "Nifty 500", "short": "Nifty 500", "group": "India", "kind": "index",
     "about": "The 500 largest companies — the broad market"},
    {"key": "gold", "symbol": "GOLDBEES.NS", "name": "Gold BeES", "short": "Gold", "group": "Villa parts", "kind": "gold",
     "about": "Nippon India ETF Gold BeES, ₹ per unit — the villas' gold part"},
    {"key": "arbitrage", "symbol": None, "name": "Nifty 50 Arbitrage", "short": "Arbitrage", "group": "Villa parts", "kind": "arbitrage",
     "about": "The arbitrage index — the villas' income part. Not quoted live: last close from the index file"},
    {"key": "rupee", "symbol": "INR=X", "name": "Rupee vs US$", "short": "Rupee", "group": "World", "kind": "fx",
     "about": "The rupee against the US dollar — up = the rupee strengthened (level = ₹ per US$)"},
    {"key": "us10y", "symbol": "^TNX", "name": "US 10-year yield", "short": "US 10-yr", "group": "World", "kind": "yield",
     "about": "US Treasury 10-year yield, % a year"},
    {"key": "sp500", "symbol": "^GSPC", "name": "S&P 500", "short": "S&P 500", "group": "World", "kind": "us",
     "about": "The US stock market — 500 largest US companies"},
]
_BY_KEY = {i["key"]: i for i in ITEMS}
PART_OF = {"arbitrage": "arbitrage", "gold": "gold", "large": "nifty50", "mid": "mid", "small": "small"}   # villa part → item
RANGES = ["1d", "1w", "1m", "3m", "ytd", "1y", "3y", "5y", "10y", "15y", "custom"]
MAX_YEARS = 15
INTRADAY = ("1d", "1w")
# item key → series key in the daily index store (app.market): TOTAL-RETURN indices, Gold BeES NAV
STORE_KEY = {"nifty50": "large", "n100": "n100", "mid": "mid", "small": "small", "n500": "n500", "gold": "gold", "arbitrage": "arbitrage"}
_NSE_KEY = {"large": "nifty50", "n100": "n100", "mid": "mid", "small": "small", "n500": "n500"}   # market.live() key → ours


# ─────────────────────────────── Yahoo pulls ───────────────────────────────
def _intraday(symbols: list[str], rng: str, interval: str) -> dict[str, dict]:
    got = _spark(symbols, rng, interval)
    thin = [s for s in symbols if len(_closes(got.get(s) or {})) < 2]
    if thin:
        with ThreadPoolExecutor(max_workers=4) as ex:
            for s, res in zip(thin, ex.map(lambda x: _chart(x, rng, interval), thin)):
                if res:
                    got[s] = res
    return got


def _daily(symbols: list[str]) -> dict[str, dict]:
    """Two years of daily closes per symbol (cached 90 s — carries the latest quote too)."""
    def load():
        got = _spark(symbols, "2y", "1d")
        thin = [s for s in symbols if len(_closes(got.get(s) or {})) < 5]
        for s in thin:
            res = _chart(s, "2y", "1d")
            if res:
                got[s] = res
        return got or None
    return _cached("in:daily", 90, load) or {}


def _day_series(res: dict) -> dict:
    """{days: [iso], vals: [close], last, session, time, high, low} — the latest price is the
    session's close so far, keyed by the exchange-local date."""
    m = res.get("meta") or {}
    tz = _tz(m)
    by_day: dict[str, float] = {}
    for t, c in _closes(res):
        k = _daykey(t, tz)
        if datetime.fromisoformat(k).weekday() < 5:
            by_day[k] = c
    last = m.get("regularMarketPrice")
    when = m.get("regularMarketTime")
    session = _daykey(when, tz) if when else (max(by_day) if by_day else None)
    # a 24-hour market (the rupee) ticks over the weekend: that is not a session — the last
    # weekday with bars is, and its daily close is the level
    if session and datetime.fromisoformat(session).weekday() >= 5:
        session = max((d for d in by_day if d < session), default=None)
        last = by_day.get(session) if session else None
        when = None
    elif last is not None and session:
        by_day[session] = last
    days = sorted(by_day)
    return {"days": days, "vals": [by_day[d] for d in days], "last": last, "session": session, "time": when,
            "high": m.get("regularMarketDayHigh"), "low": m.get("regularMarketDayLow"), "tz": tz}


def _prev_close(s: dict) -> Optional[float]:
    for d, v in zip(reversed(s["days"]), reversed(s["vals"])):
        if s["session"] and d < s["session"]:
            return v
    return None


def _range_start(session: str, rng: str) -> str:
    d = date.fromisoformat(session)
    if rng == "1w":
        return (d - timedelta(days=7)).isoformat()
    if rng == "1m":
        return (d - timedelta(days=30)).isoformat()
    if rng == "3m":
        return (d - timedelta(days=91)).isoformat()
    if rng == "ytd":
        return f"{d.year - 1}-12-31"
    n = {"1y": 1, "3y": 3, "5y": 5, "10y": 10, "15y": 15}.get(rng, 1)
    try:
        return d.replace(year=d.year - n).isoformat()
    except ValueError:
        return d.replace(year=d.year - n, day=28).isoformat()


def _epoch(day: str) -> int:
    """Noon UTC of a calendar day — a stable x for daily points across time zones."""
    return int(datetime.fromisoformat(day + "T12:00:00+00:00").timestamp())


# ─────────────────────────────── one item ───────────────────────────────
def _item_yahoo(i: dict, rng: str, day: dict, intra: Optional[dict]) -> dict:
    s = _day_series(day)
    prev = _prev_close(s)
    last = s["last"]
    row = {"key": i["key"], "name": i["name"], "short": i["short"], "group": i["group"], "kind": i["kind"], "about": i["about"],
           "ok": last is not None and prev is not None, "last": last, "prev": prev, "session": s["session"], "time": s["time"],
           "high": s["high"], "low": s["low"], "source": "live",
           "day_pct": None if last is None or not prev else (last - prev if i["kind"] == "yield" else (last / prev - 1) * 100)}
    if not row["ok"]:
        row.update(pct=None, base=None, t=[], v=[])
        return row
    if rng == "1d":
        base = prev
        pts = _closes(intra or {})
        tz = s["tz"]
        pts = [(t, c) for t, c in pts if _daykey(t, tz) == s["session"]]      # the session's bars only
        if not pts or (s["time"] and pts[-1][0] < s["time"]):
            pts.append((s["time"] or (pts[-1][0] if pts else int(time.time())), last))
        elif pts and s["time"] is None:
            pts[-1] = (pts[-1][0], last)
    elif rng == "1w":
        start = _range_start(s["session"], rng)
        base = _at(s["days"], s["vals"], start) or s["vals"][0]
        tz = s["tz"]
        pts = [(t, c) for t, c in _closes(intra or {}) if _daykey(t, tz) > start]
        if not pts or (s["time"] and pts[-1][0] < s["time"]):
            pts.append((s["time"] or (pts[-1][0] if pts else int(time.time())), last))
        elif pts and s["time"] is None:
            pts[-1] = (pts[-1][0], last)
    else:
        start = _range_start(s["session"], rng)
        base = _at(s["days"], s["vals"], start) or s["vals"][0]
        pts = [(_epoch(d), v) for d, v in zip(s["days"], s["vals"]) if d > start]
        if pts:
            pts.insert(0, (_epoch(start), base))
    if i["kind"] == "yield":
        row.update(pct=last - base, base=base, t=[t for t, _ in pts], v=[round(c - base, 4) for _, c in pts], unit="pp")
    else:
        row.update(pct=(last / base - 1) * 100, base=base, t=[t for t, _ in pts], v=[round((c / base - 1) * 100, 4) for _, c in pts])
    return row


def _item_arbitrage(i: dict, rng: str, india_session: Optional[str], span: tuple[int, int]) -> dict:
    h = market_svc.history()
    days, vals = h.get("days") or [], (h.get("series") or {}).get("arbitrage", {}).get("values") or []
    pairs = [(d, v) for d, v in zip(days, vals) if v is not None]
    row = {"key": i["key"], "name": i["name"], "short": i["short"], "group": i["group"], "kind": i["kind"], "about": i["about"],
           "source": "close", "ok": len(pairs) >= 2}
    if not row["ok"]:
        row.update(last=None, prev=None, pct=None, day_pct=None, session=None, time=None, t=[], v=[], base=None)
        return row
    (pd, prev), (ld, last) = pairs[-2], pairs[-1]
    day_pct = (last / prev - 1) * 100
    row.update(last=last, prev=prev, session=ld, time=_epoch(ld), day_pct=day_pct, high=None, low=None)
    if rng in ("1d", "1w"):
        if rng == "1d":
            pct = day_pct if ld == india_session else 0.0        # an older close says nothing about today
            base = prev if ld == india_session else last
        else:
            start = _range_start(ld, rng)
            base = _at([d for d, _ in pairs], [v for _, v in pairs], start) or pairs[0][1]
            pct = (last / base - 1) * 100
        row.update(pct=pct, base=base, t=[span[0], span[1]], v=[round(pct, 4), round(pct, 4)])    # held flat across the window
    else:
        start = _range_start(ld, rng)
        ds, vs = [d for d, _ in pairs], [v for _, v in pairs]
        base = _at(ds, vs, start) or vs[0]
        pts = [(_epoch(d), v) for d, v in pairs if d > start]
        pts.insert(0, (_epoch(start), base))
        row.update(pct=(last / base - 1) * 100, base=base, t=[t for t, _ in pts], v=[round((c / base - 1) * 100, 4) for _, c in pts])
    return row


# ─────────────────────────────── daily ranges from the index store ───────────────────────────────
def _store_pairs(key: str) -> list[tuple[str, float]]:
    h = market_svc.history()
    vals = ((h.get("series") or {}).get(key) or {}).get("values") or []
    return [(d, v) for d, v in zip(h.get("days") or [], vals) if v is not None]


def _pct_points(pairs: list[tuple[str, float]], start: str, end: str, yield_: bool = False):
    """[(epoch, % from the close on/before start)] for the days in (start, end], the start itself
    first; also the base and the window's real start (a series may begin after `start`)."""
    pairs = [(d, v) for d, v in pairs if d <= end]
    if len(pairs) < 2:
        return None
    ds, vs = [d for d, _ in pairs], [v for _, v in pairs]
    if start < ds[0]:
        start = ds[0]
    base = _at(ds, vs, start)
    if not base:
        return None
    f = (lambda v: v - base) if yield_ else (lambda v: (v / base - 1) * 100)
    pts = [(_epoch(start), 0.0)] + [(_epoch(d), round(f(v), 4)) for d, v in pairs if d > start]
    return {"pts": pts, "base": base, "start": start, "last_day": ds[-1]}


def _item_store(i: dict, start: str, end: str, s_live: Optional[dict]) -> Optional[dict]:
    """A store-backed item over (start, end]: total-return closes from the daily index store,
    extended with the live price index's moves for the days after the store's last close."""
    got = _pct_points(_store_pairs(STORE_KEY[i["key"]]), start, end)
    if not got:
        return None
    pts, last_day = got["pts"], got["last_day"]
    if s_live and s_live.get("days") and end > last_day:
        y0 = _at(s_live["days"], s_live["vals"], last_day)
        p_end = pts[-1][1]
        if y0:
            for d, v in zip(s_live["days"], s_live["vals"]):
                if last_day < d <= end:
                    pts.append((_epoch(d), round(((1 + p_end / 100) * (v / y0) - 1) * 100, 4)))
    live_last = s_live["last"] if s_live and s_live.get("last") is not None else None
    prev = _prev_close(s_live) if s_live else None
    store_last = _store_pairs(STORE_KEY[i["key"]])[-1][1]
    day_pct = ((live_last / prev - 1) * 100) if live_last is not None and prev else None
    if day_pct is None and i["key"] == "arbitrage":
        pr = _store_pairs("arbitrage")
        if len(pr) >= 2:
            day_pct = (pr[-1][1] / pr[-2][1] - 1) * 100
    return {"key": i["key"], "name": i["name"], "short": i["short"], "group": i["group"], "kind": i["kind"], "about": i["about"], "ok": True,
            "last": live_last if live_last is not None else store_last, "prev": prev, "base": got["base"],
            "session": (s_live or {}).get("session") or last_day, "time": (s_live or {}).get("time") or _epoch(last_day),
            "high": (s_live or {}).get("high"), "low": (s_live or {}).get("low"), "source": "close" if i["key"] == "arbitrage" else "tri",
            "day_pct": day_pct, "pct": pts[-1][1], "from": got["start"], "t": [t for t, _ in pts], "v": [v for _, v in pts]}


def _item_world_long(i: dict, start: str, end: str, s_live: Optional[dict]) -> Optional[dict]:
    """A Yahoo item over a window older than the two-year daily pull: closes since 2000."""
    h = _day_map(i["symbol"])
    if not h:
        return None
    pairs = [((date(1970, 1, 1) + timedelta(days=k)).isoformat(), v) for k, v in sorted(h["map"].items())]
    got = _pct_points(pairs, start, end, yield_=(i["kind"] == "yield"))
    if not got:
        return None
    pts = got["pts"]
    live_last = s_live["last"] if s_live and s_live.get("last") is not None else pairs[-1][1]
    prev = _prev_close(s_live) if s_live else None
    row = {"key": i["key"], "name": i["name"], "short": i["short"], "group": i["group"], "kind": i["kind"], "about": i["about"], "ok": True,
           "last": live_last, "prev": prev, "base": got["base"], "session": (s_live or {}).get("session") or got["last_day"],
           "time": (s_live or {}).get("time"), "high": (s_live or {}).get("high"), "low": (s_live or {}).get("low"), "source": "live",
           "day_pct": None if live_last is None or not prev else (live_last - prev if i["kind"] == "yield" else (live_last / prev - 1) * 100),
           "pct": pts[-1][1], "from": got["start"], "t": [t for t, _ in pts], "v": [v for _, v in pts]}
    if i["kind"] == "yield":
        row["unit"] = "pp"
    return row


# ─────────────────────────────── villas ───────────────────────────────
def _weights(v: dict, gold: bool) -> dict[str, float]:
    w = {p: float(v["weights"].get(p, 0.0)) for p in PART_OF}
    if not gold:
        g = w.pop("gold", 0.0)
        w["gold"] = 0.0
        for p in ("large", "mid", "small"):
            w[p] += g / 3
    return w


def _replay(weights: dict[str, float], items: dict[str, dict]) -> dict:
    """The villa over the window: ₹1 split by the weights at the start, each part moving with its
    % series (carried forward between its points), and at every year end inside the window the
    growth engine (everything but arbitrage) reset to its target split — as the villas do.
    Pre-tax. Within a day there is no reset, so it is exactly the weighted sum of the parts."""
    parts = {p: items.get(k) for p, k in PART_OF.items() if weights.get(p, 0) > 0}
    if any(it is None or not it.get("ok") or not it.get("t") for it in parts.values()):
        return {"ok": False, "pct": None, "day_pct": None, "t": [], "v": []}
    ts = sorted({t for it in parts.values() for t in it["t"]})
    growth = [p for p in parts if p != "arbitrage"]
    gw = sum(weights[p] for p in growth) or 1.0
    idx = {p: 0 for p in parts}
    lvl = {p: 1.0 for p in parts}
    units: Optional[dict] = None
    days = [datetime.fromtimestamp(t, tz=timezone.utc).date() for t in ts]
    out, resets = [], 0
    for k, t in enumerate(ts):
        for p, it in parts.items():
            while idx[p] < len(it["t"]) and it["t"][idx[p]] <= t:
                lvl[p] = 1 + it["v"][idx[p]] / 100
                idx[p] += 1
        if units is None:
            units = {p: weights[p] for p in parts}          # every series is % from the window's base (level 1), not from its first bar
        out.append(round((sum(units[p] * lvl[p] for p in parts) - 1) * 100, 4))
        nxt = days[k + 1] if k + 1 < len(ts) else None
        if k > 0 and days[k].month == 12 and nxt and nxt.year > days[k].year and growth:
            gv = sum(units[p] * lvl[p] for p in growth)
            for p in growth:
                units[p] = gv * (weights[p] / gw) / lvl[p]
            resets += 1
    return {"ok": True, "pct": out[-1], "resets": resets,
            "day_pct": sum(weights[p] * (it["day_pct"] or 0.0) for p, it in parts.items()), "t": ts, "v": out}


# ─────────────────────────────── the board ───────────────────────────────
def _window(rng: str, session: str, start: Optional[str], end: Optional[str]) -> tuple[str, str]:
    """(start, end) for the range — custom dates clamped to the last 15 years and the session."""
    if rng == "custom":
        d = date.fromisoformat(session)
        floor = d.replace(year=d.year - MAX_YEARS, day=min(d.day, 28)).isoformat()
        try:
            e = min(date.fromisoformat(end).isoformat(), session) if end else session
        except ValueError:
            e = session
        try:
            st = date.fromisoformat(start).isoformat() if start else _range_start(e, "1y")
        except ValueError:
            st = _range_start(e, "1y")
        st = max(st, floor)
        if st >= e:
            st = _range_start(e, "1m")
        return st, e
    return _range_start(session, rng), session


def board(rng: str = "1d", start: Optional[str] = None, end: Optional[str] = None) -> dict:
    rng = rng if rng in RANGES else "1d"
    if rng != "custom":
        start = end = None

    def load():
        syms = [i["symbol"] for i in ITEMS if i["symbol"]]
        daily = _daily(syms)
        if len(daily) < len(syms) * 0.6:
            return None
        intra: dict[str, dict] = {}
        if rng == "1d":
            intra = _intraday(syms, "1d", "5m")
        elif rng == "1w":
            intra = _intraday(syms, "5d", "30m")
        items: dict[str, dict] = {}
        S = {sym: _day_series(res) for sym, res in daily.items()}
        n50s = S.get("^NSEI") or {}
        session = n50s.get("session") or date.today().isoformat()
        w_start, w_end = _window(rng, session, start, end)
        two_years = _range_start(session, "1y")
        two_years = (date.fromisoformat(two_years) - timedelta(days=360)).isoformat()
        for i in ITEMS:
            if not i["symbol"]:
                continue
            s_live = S.get(i["symbol"])
            if rng in INTRADAY:
                if i["symbol"] in daily:
                    items[i["key"]] = _item_yahoo(i, rng, daily[i["symbol"]], intra.get(i["symbol"]))
            elif i["key"] in STORE_KEY:
                items[i["key"]] = _item_store(i, w_start, w_end, s_live) or (_item_yahoo(i, "1y", daily[i["symbol"]], None) if i["symbol"] in daily else None)
            elif w_start < two_years or rng == "custom":
                items[i["key"]] = _item_world_long(i, w_start, w_end, s_live) or (_item_yahoo(i, "1y", daily[i["symbol"]], None) if i["symbol"] in daily else None)
            else:
                if i["symbol"] in daily:
                    items[i["key"]] = _item_yahoo(i, rng, daily[i["symbol"]], None)
        items = {k: v for k, v in items.items() if v}
        # NSE's own board: the official day numbers for the Indian indices on the same session
        live = market_svc.live()
        if live.get("quotes") and live.get("day"):
            for mk, ok in _NSE_KEY.items():
                q, it = live["quotes"].get(mk), items.get(ok)
                if q and it and it.get("ok") and it["session"] == live["day"] and q.get("last") and q.get("prev"):
                    it.update(last=q["last"], prev=q["prev"], day_pct=(q["last"] / q["prev"] - 1) * 100,
                              high=q.get("high") or it["high"], low=q.get("low") or it["low"], adv=q.get("adv"), dec=q.get("dec"))
                    if rng == "1d":
                        it["pct"] = it["day_pct"]
                        if it["v"]:
                            it["v"][-1] = round(it["pct"], 4)
                    elif rng == "1w" and it.get("base"):
                        it["pct"] = (q["last"] / it["base"] - 1) * 100
                        if it["v"]:
                            it["v"][-1] = round(it["pct"], 4)
        rp = items.get("rupee")
        if rp and rp.get("ok"):
            inv = lambda x: None if x is None else (1 / (1 + x / 100) - 1) * 100
            rp["pct"], rp["day_pct"] = inv(rp["pct"]), inv(rp["day_pct"])
            rp["v"] = [round(inv(x), 4) for x in rp["v"]]
        n50 = items.get("nifty50") or {}
        span = (min((it["t"][0] for it in items.values() if it.get("t")), default=int(time.time()) - 21600),
                max((it["t"][-1] for it in items.values() if it.get("t")), default=int(time.time())))
        if rng in ("1d", "1w") and n50.get("t"):
            span = (n50["t"][0], n50["t"][-1])              # the flat arbitrage line spans the Indian sessions only
        if rng in INTRADAY:
            items["arbitrage"] = _item_arbitrage(_BY_KEY["arbitrage"], rng, n50.get("session"), span)
        else:
            arb = _item_store(_BY_KEY["arbitrage"], w_start, w_end, None)
            if arb:
                items["arbitrage"] = arb
        cfg = calc_config.get()
        villas = []
        for v in cfg.get("villas") or []:
            villas.append({"key": v["key"], "name": v["name"], "risk": v.get("risk"), "risk_name": v.get("risk_name"),
                           "weights": _weights(v, True), "weights_no_gold": _weights(v, False),
                           "with_gold": _replay(_weights(v, True), items), "no_gold": _replay(_weights(v, False), items)})
        return {
            "as_of": int(time.time()), "range": rng, "ranges": RANGES,
            "nse": {"open": bool(live.get("open")), "status": live.get("status") or "", "day": live.get("day"), "time": live.get("time")},
            "session": n50.get("session"), "window": {"start": w_start, "end": w_end}, "max_years": MAX_YEARS,
            "sources": {"intraday": "Live price indices (5-minute bars) and the live Gold BeES price; the arbitrage index holds its last close.",
                        "daily": "Total-return indices and Gold BeES NAV from the daily index file (April 2010 on), extended with today's live move."},
            "items": [items[i["key"]] for i in ITEMS if i["key"] in items],
            "villas": villas, "default_villa": cfg.get("default_villa"),
            "parts": {p: _BY_KEY[k]["name"] for p, k in PART_OF.items()},
        }
    ttl = 45 if rng in INTRADAY else 300
    return _cached(f"in:board:{rng}:{start or ''}:{end or ''}", ttl, load) or {
        "as_of": None, "range": rng, "ranges": RANGES, "nse": {}, "session": None, "window": None, "max_years": MAX_YEARS,
        "items": [], "villas": [], "default_villa": None, "parts": {}}


# ─────────────────────────────── any index, on demand ("Your mix") ───────────────────────────────
def _live_day(q: Optional[dict], live: dict) -> Optional[str]:
    return live.get("day") if q and q.get("last") is not None and q.get("prev") else None


def _extra_one(c: dict, rng: str, w_start: str, w_end: str, session: Optional[str], span: tuple[int, int], live: dict) -> Optional[dict]:
    from app import index_catalog as cat
    i = {**c, "group": c["group"]}
    q = (live.get("all") or {}).get(c["nifty"].upper()) if c.get("nifty") else None
    q_day = _live_day(q, live)
    base_row = {"key": c["key"], "name": c["name"], "short": c["short"], "group": c["group"], "kind": c["kind"], "about": c["about"]}
    if rng in INTRADAY and c.get("symbol"):
        daily = _cached(f"in:x:d:{c['symbol']}", 90, lambda: _chart(c["symbol"], "2y", "1d"))
        intra = _cached(f"in:x:i:{c['symbol']}:{rng}", 45,
                        lambda: _chart(c["symbol"], "1d" if rng == "1d" else "5d", "5m" if rng == "1d" else "30m"))
        if not daily:
            return None
        row = _item_yahoo(i, rng, daily, intra)
        if q and row.get("ok") and row["session"] == q_day:             # NSE's official numbers for the same session
            row.update(last=q["last"], prev=q["prev"], day_pct=(q["last"] / q["prev"] - 1) * 100)
            if rng == "1d":
                row["pct"] = row["day_pct"]
                if row["v"]:
                    row["v"][-1] = round(row["pct"], 4)
        return {**row, **base_row}
    if c.get("nifty"):
        h = cat.nse_history(c["key"])
        pairs = sorted(h.items())
        if len(pairs) < 2:
            return None
        last_day, last_close = pairs[-1]
        prev_close = pairs[-2][1]
        # NSE's live board is ahead of the stored closes during the day
        live_last, live_prev = (q["last"], q["prev"]) if q_day and q_day > last_day else (None, None)
        day_pct = ((live_last / live_prev - 1) * 100) if live_last else ((last_close / prev_close - 1) * 100)
        sess = q_day if live_last else last_day
        if rng == "1d":
            pct = day_pct if sess == session else 0.0
            pts = [(span[0], 0.0), (span[1], round(pct, 4))]                 # no bars: a straight line to the live move
            return {**base_row, "ok": True, "last": live_last or last_close, "prev": live_prev or prev_close, "base": live_prev or prev_close,
                    "session": sess, "time": span[1], "source": "close", "day_pct": day_pct, "pct": pct,
                    "t": [t for t, _ in pts], "v": [v for _, v in pts]}
        got = _pct_points(pairs, w_start if rng != "1w" else _range_start(sess, "1w"), w_end if rng != "1w" else sess)
        if not got:
            return None
        pts = got["pts"]
        if live_last and sess <= (w_end if rng != "1w" else sess):
            p_end = pts[-1][1]
            pts.append((_epoch(sess), round(((1 + p_end / 100) * (live_last / last_close) - 1) * 100, 4)))
        return {**base_row, "ok": True, "last": live_last or last_close, "prev": live_prev or prev_close, "base": got["base"],
                "session": sess, "time": _epoch(sess), "source": "tri", "day_pct": day_pct, "pct": pts[-1][1], "from": got["start"],
                "t": [t for t, _ in pts], "v": [v for _, v in pts]}
    # Yahoo-only (BSE, world, commodities): the board's own long / short paths
    daily = _cached(f"in:x:d:{c['symbol']}", 90, lambda: _chart(c["symbol"], "2y", "1d"))
    s_live = _day_series(daily) if daily else None
    two_years = (date.fromisoformat(_range_start(session or date.today().isoformat(), "1y")) - timedelta(days=360)).isoformat()
    row = None
    if w_start < two_years or rng == "custom":
        row = _item_world_long(i, w_start, w_end, s_live)
    if not row and daily:
        row = _item_yahoo(i, rng if rng not in ("custom",) else "1y", daily, None)
    if row and c["key"] == "rupee" and row.get("ok"):                     # + = the rupee stronger, as on the board
        inv = lambda x: None if x is None else (1 / (1 + x / 100) - 1) * 100
        row["pct"], row["day_pct"], row["v"] = inv(row["pct"]), inv(row["day_pct"]), [round(inv(x), 4) for x in row["v"]]
    return {**row, **base_row} if row else None


def extra(keys: list[str], rng: str = "1d", start: Optional[str] = None, end: Optional[str] = None) -> dict:
    """Catalogue indices over the same range as the board — for the admin's own mixes."""
    from app import index_catalog as cat
    rng = rng if rng in RANGES else "1d"
    if rng != "custom":
        start = end = None
    keys = sorted({k for k in keys if k in cat.BY_KEY and k not in cat.BOARD_KEYS})[:24]
    if not keys:
        return {"items": []}

    def load():
        b = board(rng, start, end)
        w = b.get("window") or {}
        session = b.get("session")
        n50 = next((it for it in b.get("items") or [] if it["key"] == "nifty50"), None) or {}
        span = (n50["t"][0], n50["t"][-1]) if n50.get("t") else (int(time.time()) - 21600, int(time.time()))
        live = market_svc.live()
        w_start, w_end = w.get("start") or _range_start(session or date.today().isoformat(), "1y"), w.get("end") or session
        with ThreadPoolExecutor(max_workers=6) as ex:
            rows = list(ex.map(lambda k: _safe(lambda: _extra_one(cat.BY_KEY[k], rng, w_start, w_end, session, span, live)), keys))
        return {"items": [r for r in rows if r]}
    return _cached(f"in:extra:{rng}:{start or ''}:{end or ''}:{','.join(keys)}", 45 if rng in INTRADAY else 300, load) or {"items": []}


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None
