"""How each of the client's funds moved — today, and against its own index
since they bought it. Powers the home screen's day-change sheet:

  view 1 · today      each fund's ₹ and % move between its last two NAVs, next to
                      the same day's move of the index it tracks
  view 2 · vs index   each fund's NAV and its index, day by day, rebased to 100 —
                      from the first purchase, or over 1y / 3y / 5y — with the
                      daily % moves underneath

Payload (one call, gzip'd by the app, memoised 15 min per client):
  {
    nav_date, prev_date,                      the portfolio's newest / previous NAV days
    total: {change, pct, value},              Σ units × ΔNAV, % of the previous value
    days: ["YYYY-MM-DD", …],                  ONE calendar: the index's trading days over the
                                              last 5 years, plus any newer NAV days
    funds: [{
      scheme_code, name, short, sleeve, color_key,
      units, value, invested, since,          since = the client's first purchase of it
      nav, prev_nav, nav_date, prev_date, day_change, day_pct,
      bench: {key, name, day_pct, day_date} | null,
      from: <index into days>,                the fund's series starts here
      nav_series: [...], index_series: [...]  same length, aligned to days[from:],
                                              index null where the store has no day yet
    }],
    portfolio: {from, invested: [...], value: [...]}   what was put in vs what it was worth,
                                              day by day since the first purchase
  }
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

from app import client_portfolio as cp
from app import market_daily

_YEARS = 5


def _short(name: str) -> str:
    s = re.sub(r"\s*-\s*(Direct|Regular)?\s*(Plan)?\s*-?\s*(Growth|IDCW|Dividend).*$", "", name or "", flags=re.I)
    s = re.sub(r"\s+(Growth|Gr)$", "", s, flags=re.I)
    s = re.sub(r"\s+Fund$", "", s.strip(), flags=re.I).strip()
    if s and s == s.upper():                      # "BANDHAN SMALL CAP" → "Bandhan Small Cap"
        s = " ".join(w if w in ("ETF", "FOF", "FD", "SBI", "HDFC", "ICICI", "UTI", "DSP", "LIC", "PGIM", "HSBC") else w.capitalize() for w in s.split())
    return s or (name or "Fund")


def _txns(client_code: str) -> list[dict]:
    """The client's transactions, signed: [{code, day, units, amount}] oldest first."""
    try:
        rows = cp._sb().table("client_transactions").select("scheme_code,txn_date,kind,units,amount").eq(
            "client_code", client_code).execute().data or []
    except Exception:
        return []
    out = []
    for r in rows:
        c, d = r.get("scheme_code"), str(r.get("txn_date") or "")[:10]
        if not c or not d:
            continue
        sg = cp._txn_sign(r.get("kind"))
        out.append({"code": c, "day": d, "units": abs(cp._num(r.get("units"))) * sg, "amount": abs(cp._num(r.get("amount"))) * sg})
    out.sort(key=lambda t: t["day"])
    return out


def _since_by_scheme(txns: list[dict]) -> dict[int, str]:
    out: dict[int, str] = {}
    for t in txns:
        if t["amount"] > 0 and (t["code"] not in out or t["day"] < out[t["code"]]):
            out[t["code"]] = t["day"]
    return out


def _portfolio_series(txns: list[dict], days: list[str], navmaps: dict[int, dict[str, float]]) -> Optional[dict]:
    """Day by day since the first purchase: what the client had put in, and what
    it was worth — units held on each day (from the transactions) × that day's
    NAV. {from, invested, value} aligned to days[from:]."""
    if not txns or not days:
        return None
    first = txns[0]["day"]
    from_i = next((i for i, d in enumerate(days) if d >= first), None)
    if from_i is None:
        return None
    held: dict[int, float] = {}
    put_in = 0.0
    j = 0
    last_nav: dict[int, float] = {}
    invested, value = [], []
    for d in days[from_i:]:
        while j < len(txns) and txns[j]["day"] <= d:
            t = txns[j]
            held[t["code"]] = held.get(t["code"], 0.0) + t["units"]
            put_in += t["amount"]
            j += 1
        v = 0.0
        for code, u in held.items():
            if u <= 1e-9:
                continue
            nm = navmaps.get(code) or {}
            if d in nm:
                last_nav[code] = nm[d]
            nav = last_nav.get(code)
            v += u * nav if nav else 0.0
        invested.append(round(put_in, 2))
        value.append(round(v, 2))
    return {"from": from_i, "invested": invested, "value": value}


def _bench_day(days: list[str], vals: list, nav_date: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    """The index's % move on nav_date (vs its previous trading day), when the
    store has that day; else None — the app says the close isn't in yet."""
    if not nav_date or not days:
        return None, None
    try:
        i = days.index(nav_date)
    except ValueError:
        return None, None
    j = i - 1
    while j >= 0 and vals[j] is None:
        j -= 1
    if j < 0 or vals[i] is None or not vals[j]:
        return None, None
    # the store carries a series' last value over a day it hasn't published (gold
    # often lands a day late): an exactly unchanged close is that, not a flat day
    if vals[i] == vals[j]:
        return None, None
    return round((vals[i] / vals[j] - 1) * 100, 4), days[i]


def _build(client_code: str) -> dict:
    hs = cp._valued_holdings(client_code)
    hs = [h for h in hs if h.get("scheme_code") and (h.get("units") or 0) > 0]
    day = cp._day_summary(hs) or {}
    store = market_daily.history()
    idx_days: list[str] = store.get("days") or []
    txns = _txns(client_code)
    since = _since_by_scheme(txns)
    # NAV history for every fund held now AND every fund ever transacted (the growth line needs both)
    navfull = cp._nav_full_map(hs + [{"scheme_code": c} for c in {t["code"] for t in txns}])

    start = (date.today() - timedelta(days=365 * _YEARS + 3)).isoformat()
    cal = [d for d in idx_days if d >= start]
    # newer NAV days than the index store has (it trails by a day or two)
    extra: set[str] = set()
    last_idx = cal[-1] if cal else start
    for h in hs:
        for p in navfull.get(h["scheme_code"]) or []:
            if p.date > last_idx:
                extra.add(p.date)
    days = cal + sorted(extra)
    pos = {d: i for i, d in enumerate(days)}

    funds = []
    value_total = sum(h.get("current_value") or 0 for h in hs)
    for h in hs:
        code = h["scheme_code"]
        sleeve = cp._holding_sleeve(code, h.get("scheme_name") or "")
        bkey = market_daily.BENCH_BY_SLEEVE.get(sleeve, "n500")
        bvals = (store.get("series", {}).get(bkey) or {}).get("values") if bkey else None
        bmap = {d: v for d, v in zip(idx_days, bvals)} if bvals else {}

        pts = navfull.get(code) or []
        navmap = {p.date: p.nav for p in pts if p.nav}
        first_nav = min(navmap) if navmap else None
        if not first_nav:
            continue
        # the series starts at the first day both the fund and the calendar have
        from_i = next((i for i, d in enumerate(days) if d >= first_nav), None)
        if from_i is None:
            continue
        nav_series: list[Optional[float]] = []
        index_series: list[Optional[float]] = []
        last_nav = None
        for d in days[from_i:]:
            if d in navmap:
                last_nav = navmap[d]
            nav_series.append(round(last_nav, 4) if last_nav else None)
            v = bmap.get(d)
            index_series.append(round(v, 4) if v else None)
        # trim leading days before the fund's first NAV actually lands
        k = next((i for i, v in enumerate(nav_series) if v), 0)
        from_i, nav_series, index_series = from_i + k, nav_series[k:], index_series[k:]

        prev = h.get("prev_nav")
        nav = h.get("nav")
        day_pct = round((nav / prev - 1) * 100, 4) if (nav and prev) else None
        bpct, bday = _bench_day(idx_days, bvals or [], h.get("nav_date")) if bvals else (None, None)
        funds.append({
            "scheme_code": code, "name": h.get("scheme_name") or "Fund", "short": _short(h.get("scheme_name") or ""),
            "sleeve": sleeve,
            "units": round(h.get("units") or 0, 3), "value": round(h.get("current_value") or 0, 2),
            "invested": round(h.get("invested") or 0, 2),
            "weight": round((h.get("current_value") or 0) / value_total * 100, 2) if value_total else 0,
            "since": since.get(code),
            "nav": nav, "prev_nav": prev, "nav_date": h.get("nav_date"), "prev_date": h.get("prev_date"),
            "day_change": round(h["day_change"], 2) if h.get("day_change") is not None else None,
            "day_pct": day_pct,
            "bench": ({"key": bkey, "name": market_daily.SHORT.get(bkey, bkey), "day_pct": bpct, "day_date": bday}
                      if bkey else None),
            "from": from_i, "nav_series": nav_series, "index_series": index_series,
        })
    funds.sort(key=lambda f: -(f["value"] or 0))
    navmaps = {c: {p.date: p.nav for p in (pts or []) if p.nav} for c, pts in navfull.items()}
    portfolio = _portfolio_series(txns, days, navmaps)
    # every index the store has, aligned to `days` — the app lets a client compare any fund
    # (or everything) with the index they choose, not only the one its sleeve follows
    indices = []
    for key, ser in (store.get("series") or {}).items():
        vals = ser.get("values") or []
        if not any(vals):
            continue
        vmap = {d: v for d, v in zip(idx_days, vals)}
        indices.append({"key": key, "name": ser.get("name") or key, "short": market_daily.SHORT.get(key, ser.get("name") or key),
                        "series": [round(vmap[d], 4) if vmap.get(d) else None for d in days]})
    return {
        "portfolio": portfolio, "indices": indices,
        "nav_date": day.get("nav_date"), "prev_date": day.get("prev_date"),
        "total": {"change": day.get("change"), "pct": day.get("pct"), "value": round(value_total, 2)},
        "index_as_of": idx_days[-1] if idx_days else None,
        "days": days, "funds": funds,
    }


def fund_moves(owner: str) -> dict:
    code = cp.client_code_for_owner(owner)
    if not code:
        return {"nav_date": None, "prev_date": None, "total": {"change": None, "pct": None, "value": 0},
                "index_as_of": None, "days": [], "funds": [], "portfolio": None}
    # keyed on the holdings themselves, so an upload (a purchase, an SWP) shows the moment it lands
    try:
        held = "|".join(sorted(f"{h.get('scheme_code')}:{round(h.get('units') or 0, 3)}" for h in cp._valued_holdings(code)))
    except Exception:
        held = ""
    import hashlib
    sig = hashlib.md5(held.encode()).hexdigest()[:10]
    return cp._memo_swr(f"moves:{code}:{sig}", 900, lambda: _build(code))
