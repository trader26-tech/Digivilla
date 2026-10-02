"""Check the maths — every number the client app shows, worked out step by step.

Three checks for the admin's "Check the maths" page:

1. client_audit(code)    — one client's portfolio: each fund (units × NAV), each
                           villa (its pinned transactions × today's NAV), and a
                           tie-out that the parts add up to the total. Uses the
                           SAME NAV table the client app reads (scheme_nav_cache),
                           and the same rules (₹5L = finished villa, ₹1,500/mo
                           payout per finished villa, redemptions count negative).
2. nav_audit()           — every fund in use: the NAV the app shows vs AMFI's
                           own published file (and mfapi), with dates.
3. calc_check(kind, …)   — the calculators, recomputed here INDEPENDENTLY of the
                           app's TypeScript (client/frontend/src/app/calc/
                           backtest.model.ts) from the same month-end NAVs the
                           app downloads, with a month-by-month ledger. The admin
                           page runs the app's own formula next to it and flags
                           any difference.
"""

from __future__ import annotations

import time

from datetime import date, datetime, timezone

from typing import Optional

import httpx

from app import reports as R


from app.config import get_settings
# the calculator check lives in app/calc_check/ — re-exported here for main.py
from app.calc_check import _cfg, data_used, flat_check, payout_check, sip_check, villa_funds  # noqa: F401
from app.calc_check.settings import _finished_at, _max_houses, _villa_income, _villa_unit  # noqa: F401

REDEEM = ("redeem", "redemption", "switch out", "switch-out", "swp", "withdraw", "sell")

def _sign(kind) -> float:
    k = (kind or "").lower()
    return -1.0 if any(w in k for w in REDEEM) else 1.0

def _nav_rows(codes: set) -> dict:
    """{code: {nav, nav_date, fetched_at}} — straight from the app's NAV table."""
    out: dict = {}
    codes = [c for c in codes if c]
    if not codes:
        return out
    try:
        rows = R._sb().table("scheme_nav_cache").select("scheme_code,nav,nav_date,fetched_at").in_(
            "scheme_code", codes).execute().data or []
        for r in rows:
            out[int(r["scheme_code"])] = {"nav": float(r["nav"]) if r.get("nav") else None,
                                          "nav_date": r.get("nav_date"), "fetched_at": r.get("fetched_at")}
    except Exception:
        pass
    return out

def client_audit(code: str) -> dict:
    client = R._client(code) or {"client_code": code, "name": code}
    holdings = R._holdings(code)
    txns = R.list_transactions(code)
    villas = R.list_client_villas(code)
    mix_codes = {f["scheme_code"] for f in R._villa_mix()}
    codes = {h.get("scheme_code") for h in holdings} | {t.get("scheme_code") for t in txns}
    navs = _nav_rows(codes)

    # step 1 · funds: holdings units × NAV, and the transactions behind them
    by_code_txn: dict = {}
    for t in txns:
        c = t.get("scheme_code")
        e = by_code_txn.setdefault(c, {"units": 0.0, "amount": 0.0, "count": 0})
        e["units"] += abs(R._to_float(t.get("units"))) * _sign(t.get("kind"))
        e["amount"] += abs(R._to_float(t.get("amount"))) * _sign(t.get("kind"))
        e["count"] += 1
    funds = []
    seen = set()
    for h in holdings:
        c = h.get("scheme_code")
        seen.add(c)
        units = R._to_float(h.get("units"))
        inv = R._to_float(h.get("invested"))
        n = navs.get(c, {})
        nav = n.get("nav")
        value = units * nav if (nav and units) else inv
        tx = by_code_txn.get(c, {"units": 0.0, "amount": 0.0, "count": 0})
        funds.append({
            "scheme_code": c, "name": h.get("scheme_name"), "digivilla": c in mix_codes,
            "units": round(units, 4), "nav": nav, "nav_date": n.get("nav_date"),
            "value": round(value, 2), "invested": round(inv, 2), "gain": round(value - inv, 2),
            "txn_units": round(tx["units"], 4), "txn_amount": round(tx["amount"], 2), "txn_count": tx["count"],
            "units_match": abs(tx["units"] - units) < 0.01 if tx["count"] else None,
            "nav_missing": not nav,
        })
    for c, tx in by_code_txn.items():                     # transactions with no holding row at all
        if c not in seen and abs(tx["units"]) > 0.001:
            n = navs.get(c, {})
            name = next((t.get("scheme_name") for t in txns if t.get("scheme_code") == c), str(c))
            funds.append({"scheme_code": c, "name": name, "digivilla": c in mix_codes, "units": 0.0,
                          "nav": n.get("nav"), "nav_date": n.get("nav_date"), "value": 0.0, "invested": 0.0,
                          "gain": 0.0, "txn_units": round(tx["units"], 4), "txn_amount": round(tx["amount"], 2),
                          "txn_count": tx["count"], "units_match": False, "nav_missing": not n.get("nav")})
    funds.sort(key=lambda f: -f["value"])
    total_value = sum(f["value"] for f in funds)
    total_inv = sum(f["invested"] for f in funds)

    # step 2 · villas: each = its pinned transactions at today's NAV
    vmap = {v["id"]: v for v in villas}
    lines_by_villa: dict = {}
    unpinned = []
    for t in txns:
        c = t.get("scheme_code")
        s = _sign(t.get("kind"))
        units = abs(R._to_float(t.get("units"))) * s
        amount = abs(R._to_float(t.get("amount"))) * s
        nav = navs.get(c, {}).get("nav")
        line = {"order_id": t.get("order_id"), "date": str(t.get("txn_date") or "")[:10], "kind": t.get("kind"),
                "fund": t.get("scheme_name"), "scheme_code": c, "amount": round(amount, 2),
                "buy_nav": R._to_float(t.get("nav")) or None, "units": round(units, 4), "nav": nav,
                "value": round(units * nav, 2) if nav else round(amount, 2)}
        if t.get("villa_id") in vmap:
            lines_by_villa.setdefault(t["villa_id"], []).append(line)
        elif c in mix_codes:
            unpinned.append(line)
    houses = []
    for v in villas:
        ls = sorted(lines_by_villa.get(v["id"], []), key=lambda x: x["date"])
        if not ls:
            continue
        inv = sum(x["amount"] for x in ls)
        val = sum(x["value"] for x in ls)
        finished = v.get("status") == "constructed" or inv >= _finished_at()
        houses.append({
            "villa_id": v["id"], "since": ls[0]["date"], "invested": round(inv, 2), "value": round(val, 2),
            "gain": round(val - inv, 2), "finished": finished,
            "finished_why": ("marked finished by admin" if v.get("status") == "constructed"
                             else f"₹{inv:,.0f} ≥ ₹{_finished_at():,.0f}" if finished else f"₹{inv:,.0f} < ₹{_finished_at():,.0f}"),
            "built_pct": 100.0 if finished else round(min(99.0, inv / _villa_unit() * 100), 1),
            "payout": _villa_income() if finished else 0.0, "lines": ls,
        })
    # the app's order: finished first, then oldest first
    houses.sort(key=lambda h: (not h["finished"], h["since"]))
    houses = houses[:_max_houses()]
    for i, h in enumerate(houses):
        h["label"] = ("Villa " if h["finished"] else "Plot ") + str(i + 1)

    # step 3 · tie-out
    villas_value = sum(h["value"] for h in houses)
    unpinned_value = sum(x["value"] for x in unpinned)
    other_value = sum(f["value"] for f in funds if not f["digivilla"])
    digivilla_holdings = sum(f["value"] for f in funds if f["digivilla"])
    checks = [
        {"label": "Every fund's units = the units of its transactions",
         "ok": all(f["units_match"] is not False for f in funds),
         "detail": ", ".join(f"{f['name']}: {f['units']} vs {f['txn_units']}" for f in funds if f["units_match"] is False) or "all match"},
        {"label": "Every fund has a NAV",
         "ok": not any(f["nav_missing"] for f in funds),
         "detail": ", ".join(f["name"] for f in funds if f["nav_missing"]) or "all priced"},
        {"label": "Villas + not-yet-pinned = the DigiVilla funds held",
         "ok": abs(villas_value + unpinned_value - digivilla_holdings) < 1.0,
         "detail": f"₹{villas_value:,.2f} + ₹{unpinned_value:,.2f} = ₹{villas_value + unpinned_value:,.2f} vs ₹{digivilla_holdings:,.2f}"},
        {"label": "DigiVilla funds + other funds = portfolio value",
         "ok": abs(digivilla_holdings + other_value - total_value) < 1.0,
         "detail": f"₹{digivilla_holdings:,.2f} + ₹{other_value:,.2f} = ₹{total_value:,.2f}"},
    ]
    finished_n = sum(1 for h in houses if h["finished"])
    return {
        "client": {"code": code, "name": (client.get("name") or code).strip(), "phone": client.get("phone")},
        "funds": funds, "houses": houses, "unpinned": unpinned,
        "app": {   # what the client's app shows
            "portfolio_value": round(total_value, 2), "invested": round(total_inv, 2),
            "gain": round(total_value - total_inv, 2),
            "gain_pct": round((total_value - total_inv) / total_inv * 100, 2) if total_inv else 0,
            "villas_finished": finished_n, "withdrawals_month": finished_n * _villa_income(),
            "building": next((h for h in houses if not h["finished"]), None) and
                        {"label": next(h for h in houses if not h["finished"])["label"],
                         "built_pct": next(h for h in houses if not h["finished"])["built_pct"]},
        },
        "tie": {"villas": round(villas_value, 2), "unpinned": round(unpinned_value, 2),
                "other": round(other_value, 2), "total": round(total_value, 2)},
        "checks": checks,
        "uses_pins": bool(houses),
    }

_amfi: tuple[float, dict] | None = None

def _amfi_snapshot() -> dict:
    """{code: (nav, 'YYYY-MM-DD')} from AMFI's NAVAll.txt — parsed the same way
    the client app's NAV cache does (cached 10 minutes)."""
    global _amfi
    if _amfi and time.time() - _amfi[0] < 600:
        return _amfi[1]
    out: dict = {}
    try:
        r = httpx.get("https://www.amfiindia.com/spages/NAVAll.txt", timeout=40,
                      follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
        for line in r.text.splitlines():
            p = line.split(";")
            if len(p) < 8 or not p[0].strip().isdigit():
                continue
            try:
                out[int(p[0])] = (float(p[-2].strip()),
                                  datetime.strptime(p[-1].strip(), "%d-%b-%Y").date().isoformat())
            except ValueError:
                pass
    except Exception:
        pass
    if out:
        _amfi = (time.time(), out)
    return out

def _mfapi_latest(code: int):
    try:
        d = httpx.get(f"https://api.mfapi.in/mf/{code}/latest", timeout=15).json()
        p = (d.get("data") or [{}])[0]
        dd, mm, yy = p["date"].split("-")
        return float(p["nav"]), f"{yy}-{mm}-{dd}"
    except Exception:
        return None

def nav_audit() -> dict:
    codes: set = set()
    for t in ("client_holdings", "client_transactions"):
        try:
            codes |= {r["scheme_code"] for r in R._all_rows(t, "scheme_code") if r.get("scheme_code")}
        except Exception:
            pass
    codes |= {f["scheme_code"] for f in R._villa_mix()}
    ours = _nav_rows(codes)
    amfi = _amfi_snapshot()
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:
        mf = dict(zip(sorted(codes), ex.map(_mfapi_latest, sorted(codes))))
    names = {f["scheme_code"]: f["scheme_name"] for f in R._villa_mix()}
    try:
        for r in R._all_rows("client_holdings", "scheme_code,scheme_name"):
            names.setdefault(r.get("scheme_code"), r.get("scheme_name"))
    except Exception:
        pass
    rows = []
    for c in sorted(codes):
        o = ours.get(c, {})
        a = amfi.get(c)
        rows.append({
            "scheme_code": c, "name": names.get(c) or str(c),
            "app_nav": o.get("nav"), "app_date": o.get("nav_date"), "fetched_at": o.get("fetched_at"),
            "amfi_nav": a[0] if a else None, "amfi_date": a[1] if a else None,
            "mfapi_nav": mf.get(c)[0] if mf.get(c) else None, "mfapi_date": mf.get(c)[1] if mf.get(c) else None,
            "match": (a is not None and o.get("nav") is not None and o.get("nav_date") == a[1]
                      and abs(o["nav"] - a[0]) < 1e-4),
            "behind": (a is not None and o.get("nav_date") is not None and o["nav_date"] < a[1]),
        })
    return {"funds": rows, "amfi_ok": bool(amfi), "checked_at": datetime.now(timezone.utc).isoformat()}
