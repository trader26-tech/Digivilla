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
from datetime import date, datetime, timedelta
from typing import Optional

from app import market as market_svc
from app.calc_settings import calc_config
from app.globalmkts import _at, _cached, _chart, _closes, _daykey, _spark, _tz

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
    {"key": "usdinr", "symbol": "INR=X", "name": "US$ in rupees", "short": "US$ / ₹", "group": "World", "kind": "fx",
     "about": "Rupees per US dollar — up = the rupee weakened"},
    {"key": "us10y", "symbol": "^TNX", "name": "US 10-year yield", "short": "US 10-yr", "group": "World", "kind": "yield",
     "about": "US Treasury 10-year yield, % a year"},
    {"key": "sp500", "symbol": "^GSPC", "name": "S&P 500", "short": "S&P 500", "group": "World", "kind": "us",
     "about": "The US stock market — 500 largest US companies"},
]
_BY_KEY = {i["key"]: i for i in ITEMS}
PART_OF = {"arbitrage": "arbitrage", "gold": "gold", "large": "nifty50", "mid": "mid", "small": "small"}   # villa part → item
RANGES = ["1d", "1w", "1m", "3m", "ytd", "1y"]
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
    try:
        return d.replace(year=d.year - 1).isoformat()
    except ValueError:
        return d.replace(year=d.year - 1, day=28).isoformat()


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


# ─────────────────────────────── villas ───────────────────────────────
def _weights(v: dict, gold: bool) -> dict[str, float]:
    w = {p: float(v["weights"].get(p, 0.0)) for p in PART_OF}
    if not gold:
        g = w.pop("gold", 0.0)
        w["gold"] = 0.0
        for p in ("large", "mid", "small"):
            w[p] += g / 3
    return w


def _basket(weights: dict[str, float], items: dict[str, dict]) -> dict:
    """Σ w_p × part % on the union of the parts' time stamps (each part carried forward;
    0 before its first point)."""
    parts = {p: items.get(k) for p, k in PART_OF.items() if weights.get(p, 0) > 0}
    if any(it is None or not it.get("ok") for it in parts.values()):
        return {"ok": False, "pct": None, "day_pct": None, "t": [], "v": []}
    ts = sorted({t for it in parts.values() for t in it["t"]})
    idx = {p: 0 for p in parts}
    cur = {p: 0.0 for p in parts}
    out = []
    for t in ts:
        for p, it in parts.items():
            while idx[p] < len(it["t"]) and it["t"][idx[p]] <= t:
                cur[p] = it["v"][idx[p]]
                idx[p] += 1
        out.append(round(sum(weights[p] * cur[p] for p in parts), 4))
    return {"ok": True, "pct": sum(weights[p] * it["pct"] for p, it in parts.items()),
            "day_pct": sum(weights[p] * (it["day_pct"] or 0.0) for p, it in parts.items()), "t": ts, "v": out}


# ─────────────────────────────── the board ───────────────────────────────
def board(rng: str = "1d") -> dict:
    rng = rng if rng in RANGES else "1d"

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
        for i in ITEMS:
            if i["symbol"] and i["symbol"] in daily:
                items[i["key"]] = _item_yahoo(i, rng, daily[i["symbol"]], intra.get(i["symbol"]))
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
                    elif it.get("base"):
                        it["pct"] = (q["last"] / it["base"] - 1) * 100
                        if it["v"]:
                            it["v"][-1] = round(it["pct"], 4)
        n50 = items.get("nifty50") or {}
        span = (min((it["t"][0] for it in items.values() if it.get("t")), default=int(time.time()) - 21600),
                max((it["t"][-1] for it in items.values() if it.get("t")), default=int(time.time())))
        if rng in ("1d", "1w") and n50.get("t"):
            span = (n50["t"][0], n50["t"][-1])              # the flat arbitrage line spans the Indian sessions only
        items["arbitrage"] = _item_arbitrage(_BY_KEY["arbitrage"], rng, n50.get("session"), span)
        cfg = calc_config.get()
        villas = []
        for v in cfg.get("villas") or []:
            villas.append({"key": v["key"], "name": v["name"], "risk": v.get("risk"), "risk_name": v.get("risk_name"),
                           "weights": _weights(v, True), "weights_no_gold": _weights(v, False),
                           "with_gold": _basket(_weights(v, True), items), "no_gold": _basket(_weights(v, False), items)})
        return {
            "as_of": int(time.time()), "range": rng, "ranges": RANGES,
            "nse": {"open": bool(live.get("open")), "status": live.get("status") or "", "day": live.get("day"), "time": live.get("time")},
            "session": n50.get("session"), "items": [items[i["key"]] for i in ITEMS if i["key"] in items],
            "villas": villas, "default_villa": cfg.get("default_villa"),
            "parts": {p: _BY_KEY[k]["name"] for p, k in PART_OF.items()},
        }
    ttl = 45 if rng in ("1d", "1w") else 300
    return _cached(f"in:board:{rng}", ttl, load) or {"as_of": None, "range": rng, "ranges": RANGES, "nse": {}, "session": None,
                                                     "items": [], "villas": [], "default_villa": None, "parts": {}}
