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
