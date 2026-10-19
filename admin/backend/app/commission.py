"""Commission — what the distributor earns on the money clients hold.

The admin enters each fund's TRAIL commission (% a year, as the AMC pays it on
regular plans). Everything else is worked out here:

    money held in a fund (AUM) = Σ units × live NAV, over every client's holding
    commission a year          = AUM × rate ÷ 100
    commission a month         = a year ÷ 12

AUM comes from `client_holdings` (replaced by every daily Transaction Report
upload), valued at live regular-plan NAVs exactly like the Clients tab. The demo
client is left out. Funds that sit in a villa bucket but nobody holds yet are
listed too, so their rate can be set in advance.

Rates live in the `admin_config` key/value table under COMMISSION_KEY (no
migration needed); without Supabase they fall back to data/commission_rates.json.
"""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timezone

from app import reports as reports_svc

COMMISSION_KEY = "commission_rates"
MAX_RATE_PCT = 5.0                       # sanity cap: trail commissions are a few % at most
_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_LOCAL_JSON = os.path.join(_DATA_DIR, "commission_rates.json")


def _key(code, name) -> str:
    """A fund's id: its scheme code, or its name when the report had no code."""
    return str(code) if code else f"name:{(name or '').strip().lower()}"


# ── rates ────────────────────────────────────────────────────────────────────
def _sb():
    from app.supabase_client import get_supabase
    return get_supabase()


def get_rates() -> dict:
    """{'rates': {fund_key: rate_pct}, 'updated_at': iso | None}"""
    try:
        rows = (_sb().table("admin_config").select("value")
                .eq("key", COMMISSION_KEY).limit(1).execute().data or [])
        if rows and isinstance(rows[0].get("value"), dict):
            return rows[0]["value"]
        return {"rates": {}, "updated_at": None}
    except Exception:
        try:
            with open(_LOCAL_JSON, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"rates": {}, "updated_at": None}


def set_rates(patch: dict) -> dict:
    """Merge {fund_key: rate_pct | None} into the saved rates (None clears one)."""
    cur = get_rates()
    rates = dict(cur.get("rates") or {})
    for k, v in (patch or {}).items():
        if v is None or v == "":
            rates.pop(str(k), None)
            continue
        r = float(v)
        if not (0 <= r <= MAX_RATE_PCT):
            raise ValueError(f"Rate for {k} must be between 0 and {MAX_RATE_PCT}% a year")
        rates[str(k)] = round(r, 4)
    value = {"rates": rates, "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        cl = _sb()
        cl.table("admin_config").delete().eq("key", COMMISSION_KEY).execute()
        cl.table("admin_config").insert({"key": COMMISSION_KEY, "value": value}).execute()
    except Exception:
        os.makedirs(_DATA_DIR, exist_ok=True)
        tmp = _LOCAL_JSON + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2)
        os.replace(tmp, _LOCAL_JSON)
    _CACHE.clear()                      # new rates → recompute on the next read
    return value


# ── money held per fund ──────────────────────────────────────────────────────
def _all_holdings() -> list[dict]:
    cols = "client_code,scheme_name,scheme_code,folio_no,units,invested,last_nav"
    if reports_svc._use_supabase():
        try:
            return reports_svc._all_rows("client_holdings", cols)
        except Exception:
            pass
    return list(reports_svc._load_local().get("holdings", []))


_CACHE: dict = {}
_CACHE_TTL = 600          # valuing every holding at live NAV takes seconds; reuse for 10 min


def overview(fresh: bool = False) -> dict:
    """Every fund with the money held in it, its rate and what it earns (cached 10 min)."""
    hit = _CACHE.get("o")
    if not fresh and hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    out = _overview()
    _CACHE["o"] = (time.time(), out)
    return out


def _overview() -> dict:
    holdings = [h for h in _all_holdings() if h.get("client_code") != reports_svc.DEMO_CODE]
    valued = reports_svc._valuate(holdings)["holdings"]

    funds: dict[str, dict] = {}
    for raw, v in zip(holdings, valued):
        k = _key(v.get("scheme_code"), v.get("scheme_name"))
        f = funds.setdefault(k, {
            "key": k, "scheme_code": v.get("scheme_code"), "scheme_name": v.get("scheme_name") or "Fund",
            "aum": 0.0, "invested": 0.0, "clients": set(), "nav_date": v.get("nav_date"), "in_villa": False,
        })
        f["aum"] += v["current_value"]
        f["invested"] += v["invested"]
        f["clients"].add(raw.get("client_code"))

    # funds in a villa that nobody holds yet — so a rate can be set up front
    try:
        for b in reports_svc.list_buckets():
            for bf in b.get("funds", []):
                k = _key(bf.get("scheme_code"), bf.get("scheme_name"))
                f = funds.setdefault(k, {
                    "key": k, "scheme_code": bf.get("scheme_code"), "scheme_name": bf.get("scheme_name") or "Fund",
                    "aum": 0.0, "invested": 0.0, "clients": set(), "nav_date": None, "in_villa": True,
                })
                f["in_villa"] = True
    except Exception:
        pass

    saved = get_rates()
    rates = saved.get("rates") or {}
    rows = []
    for f in funds.values():
        rate = rates.get(f["key"])
        yearly = f["aum"] * rate / 100 if rate is not None else 0.0
        rows.append({
            "key": f["key"], "scheme_code": f["scheme_code"], "scheme_name": f["scheme_name"],
            "aum": round(f["aum"], 2), "invested": round(f["invested"], 2),
            "clients": len(f["clients"]), "in_villa": f["in_villa"], "nav_date": f["nav_date"],
            "rate_pct": rate, "yearly": round(yearly, 2), "monthly": round(yearly / 12, 2),
        })
    rows.sort(key=lambda r: (-r["aum"], r["scheme_name"]))

    aum = sum(r["aum"] for r in rows)
    with_rate = [r for r in rows if r["rate_pct"] is not None]
    aum_rated = sum(r["aum"] for r in with_rate)
    yearly = sum(r["yearly"] for r in rows)
    clients = {h.get("client_code") for h in holdings}
    return {
        "as_of": date.today().isoformat(),
        "updated_at": saved.get("updated_at"),
        "max_rate_pct": MAX_RATE_PCT,
        "funds": rows,
        "totals": {
            "aum": round(aum, 2), "aum_with_rate": round(aum_rated, 2),
            "yearly": round(yearly, 2), "monthly": round(yearly / 12, 2),
            # the blended rate actually earned on the money that has a rate
            "avg_rate_pct": round(yearly / aum_rated * 100, 4) if aum_rated else None,
            "funds": len(rows), "funds_missing_rate": sum(1 for r in rows if r["rate_pct"] is None and r["aum"] > 0),
            "clients": len(clients),
        },
    }


# ── the trail ledger: what has built up since the last payout, day by day ────
PAYOUT_DAY = 20                    # the AMCs pay the trail on the 20th; a cycle runs 21st → 20th


def _cycle_bounds(today: date, back: int = 0) -> tuple[date, date]:
    """(first day, payout day) of the cycle `back` cycles before the one holding `today`."""
    y, m = today.year, today.month
    if today.day > PAYOUT_DAY:                                   # already past this month's 20th → next month's cycle
        m += 1
        if m > 12:
            y, m = y + 1, 1
    m -= back
    while m < 1:
        y, m = y - 1, m + 12
    end = date(y, m, PAYOUT_DAY)
    pm, py = (m - 1, y) if m > 1 else (12, y - 1)
    start = date(py, pm, PAYOUT_DAY + 1)
    return start, end


def _nav_lookup(code: int):
    """day → the last NAV on or before it (weekends and holidays carry the previous NAV)."""
    from bisect import bisect_right
    from app.market import _fund_hist
    hist = _fund_hist(int(code))
    days = sorted(hist)
    vals = [hist[d] for d in days]

    def at(day: str) -> float | None:
        i = bisect_right(days, day)
        return vals[i - 1] if i else None
    return at


def ledger(cycles: int = 6) -> dict:
    """Trail commission accrued day by day from the real holdings: every day each
    fund's units held × that day's NAV × its trail rate ÷ 365. The current cycle
    (21st → 20th) with its running total and what the 20th should bring, and the
    last `cycles` closed cycles. The demo client is left out. An estimate at your
    saved rates — the AMC statement is the final word."""
    hit = _CACHE.get("ledger")
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    rates = {k: float(v) for k, v in (get_rates().get("rates") or {}).items()}
    txns = [t for t in reports_svc._all_rows("client_transactions", "client_code,scheme_code,scheme_name,units,amount,kind,txn_date")
            if t.get("client_code") != reports_svc.DEMO_CODE and t.get("scheme_code") and str(t["scheme_code"]) in rates]
    from app.shared_alloc import villa_alloc
    today = date.today()
    first_start, _ = _cycle_bounds(today, cycles)
    _, cur_end = _cycle_bounds(today)
    cur_start, _ = _cycle_bounds(today)
    # per fund: dated signed unit flows, sorted
    flows: dict[int, list[tuple[str, float]]] = {}
    names: dict[int, str] = {}
    for t in txns:
        code = int(t["scheme_code"])
        d = str(t.get("txn_date") or "")[:10]
        if not d:
            continue
        u = abs(reports_svc._to_float(t.get("units"))) * villa_alloc.txn_sign(t.get("kind"))
        flows.setdefault(code, []).append((d, u))
        names.setdefault(code, t.get("scheme_name") or str(code))
    for code in flows:
        flows[code].sort()
    navs = {code: _nav_lookup(code) for code in flows}
    # walk every calendar day from the oldest cycle to today
    span_days = (today - first_start).days + 1
    day_total: list[float] = []
    day_list: list[str] = []
    per_fund_cycle: dict[int, float] = {c: 0.0 for c in flows}
    units = {c: 0.0 for c in flows}
    idx = {c: 0 for c in flows}
    for k in range(span_days):
        d = first_start.fromordinal(first_start.toordinal() + k)
        ds = d.isoformat()
        tot = 0.0
        for code, fl in flows.items():
            while idx[code] < len(fl) and fl[idx[code]][0] <= ds:
                units[code] += fl[idx[code]][1]
                idx[code] += 1
            if units[code] <= 1e-9:
                continue
            nav = navs[code](ds)
            if not nav:
                continue
            a = units[code] * nav * rates[str(code)] / 100 / 365
            tot += a
            if d >= cur_start:
                per_fund_cycle[code] += a
        day_total.append(tot)
        day_list.append(ds)
    by_day = dict(zip(day_list, day_total))
    # cycles
    past = []
    for back in range(cycles, 0, -1):
        s, e = _cycle_bounds(today, back)
        total = sum(v for d, v in by_day.items() if s.isoformat() <= d <= e.isoformat())
        past.append({"start": s.isoformat(), "payout": e.isoformat(), "total": round(total, 2), "days": (e - s).days + 1})
    cur_days = [(d, v) for d, v in by_day.items() if d >= cur_start.isoformat()]
    accrued = sum(v for _, v in cur_days)
    rate_now = day_total[-1] if day_total else 0.0
    remaining = (cur_end - today).days
    series, run = [], 0.0
    for d, v in cur_days:
        run += v
        series.append({"d": d, "v": round(run, 2)})
    by_fund = sorted([{"scheme_code": c, "scheme_name": names[c], "accrued": round(a, 2),
                       "share": round(a / accrued, 4) if accrued else 0.0, "rate_pct": rates[str(c)]}
                      for c, a in per_fund_cycle.items() if a > 0], key=lambda r: -r["accrued"])
    out = {
        "as_of": today.isoformat(), "payout_day": PAYOUT_DAY,
        "current": {"start": cur_start.isoformat(), "payout": cur_end.isoformat(), "days_total": (cur_end - cur_start).days + 1,
                    "days_done": (today - cur_start).days + 1, "days_left": remaining,
                    "accrued": round(accrued, 2), "per_day": round(rate_now, 2),
                    "expected": round(accrued + rate_now * remaining, 2), "series": series, "by_fund": by_fund},
        "past": past,
        "last_payout": past[-1] if past else None,
        "funds_without_rate": sorted({t.get("scheme_name") for t in reports_svc._all_rows("client_transactions", "client_code,scheme_code,scheme_name")
                                      if t.get("client_code") != reports_svc.DEMO_CODE and t.get("scheme_code") and str(t["scheme_code"]) not in rates and t.get("scheme_name")}),
    }
    _CACHE["ledger"] = (time.time(), out)
    return out
