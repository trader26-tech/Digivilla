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

VILLA_UNIT = 500_000.0
FINISHED_AT = VILLA_UNIT * 0.99          # a lumpsum buys ~₹4,99,975 after stamp duty
VILLA_INCOME = 1500.0                    # ₹ a month per finished villa
MAX_HOUSES = 9
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


# ───────────────────────────── 1 · one client ─────────────────────────────
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
        finished = v.get("status") == "constructed" or inv >= FINISHED_AT
        houses.append({
            "villa_id": v["id"], "since": ls[0]["date"], "invested": round(inv, 2), "value": round(val, 2),
            "gain": round(val - inv, 2), "finished": finished,
            "finished_why": ("marked finished by admin" if v.get("status") == "constructed"
                             else f"₹{inv:,.0f} ≥ ₹{FINISHED_AT:,.0f}" if finished else f"₹{inv:,.0f} < ₹{FINISHED_AT:,.0f}"),
            "built_pct": 100.0 if finished else round(min(99.0, inv / VILLA_UNIT * 100), 1),
            "payout": VILLA_INCOME if finished else 0.0, "lines": ls,
        })
    # the app's order: finished first, then oldest first
    houses.sort(key=lambda h: (not h["finished"], h["since"]))
    houses = houses[:MAX_HOUSES]
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
            "villas_finished": finished_n, "withdrawals_month": finished_n * VILLA_INCOME,
            "building": next((h for h in houses if not h["finished"]), None) and
                        {"label": next(h for h in houses if not h["finished"])["label"],
                         "built_pct": next(h for h in houses if not h["finished"])["built_pct"]},
        },
        "tie": {"villas": round(villas_value, 2), "unpinned": round(unpinned_value, 2),
                "other": round(other_value, 2), "total": round(total_value, 2)},
        "checks": checks,
        "uses_pins": bool(houses),
    }


# ─────────────────────────────── 2 · NAVs ───────────────────────────────
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


# ──────────────────────── 3 · calculators, independently ────────────────────────
_vf: tuple[float, dict] | None = None


def villa_funds() -> dict:
    """The month-end NAVs the client app's calculators download (public endpoint
    of the client service), cached 10 minutes — both checks use the same data."""
    global _vf
    if _vf and time.time() - _vf[0] < 600:
        return _vf[1]
    r = httpx.get(f"{get_settings().client_api_url.rstrip('/')}/calc/villa-funds", timeout=60)
    d = r.json()
    if not d.get("ok"):
        raise ValueError(d.get("detail") or "Fund history unavailable")
    _vf = (time.time(), d)
    return d


def _window(d: dict, years: int) -> dict:
    months = d["months"]
    start = max(0, len(months) - 1 - 12 * years)
    return {"months": months[start:],
            "funds": [{**f, "nav": f["nav"][start:]} for f in d["funds"]]}


def _fy(ym: str) -> int:
    y, m = map(int, ym.split("-"))
    return y if m >= 4 else y - 1


class _Tax:
    """Gains realised in one financial year → tax, on today's rules."""
    def __init__(self, slab: float):
        self.slab = slab
        self.reset()

    def reset(self):
        self.eq_st = self.eq_lt = self.g_st = self.g_lt = 0.0

    def add(self, sleeve: str, gain: float, held_months: int):
        if sleeve == "gold":
            if held_months > 24: self.g_lt += gain
            else: self.g_st += gain
        elif held_months > 12:
            self.eq_lt += gain
        else:
            self.eq_st += gain

    def tax(self) -> float:
        st, lt = self.eq_st, self.eq_lt
        if st < 0 < lt:
            lt, st = max(0.0, lt + st), 0.0
        elif lt < 0 < st:
            st, lt = max(0.0, st + lt), 0.0
        eq = max(0.0, st) * 0.20 + max(0.0, lt - 125_000) * 0.125
        gold = max(0.0, self.g_st) * self.slab / 100 + max(0.0, self.g_lt) * 0.125
        return (eq + gold) * 1.04

    def copy(self):
        t = _Tax(self.slab)
        t.eq_st, t.eq_lt, t.g_st, t.g_lt = self.eq_st, self.eq_lt, self.g_st, self.g_lt
        return t


def _irr(flows: list[float]) -> Optional[float]:
    def npv(r): return sum(cf / (1 + r) ** i for i, cf in enumerate(flows))
    lo, hi = -0.5, 0.5
    if npv(lo) * npv(hi) >= 0:
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0: hi = mid
        else: lo = mid
    return ((1 + (lo + hi) / 2) ** 12 - 1) * 100


def payout_check(years: int, amount: float, fd_rate: float, slab: float) -> dict:
    """A lumpsum in today's mix paying ₹30,000/month per ₹1 Cr from arbitrage
    (FD vs DigiVilla, Lumpsum, and the DigiVilla side of Flat)."""
    w = _window(villa_funds(), years)
    months, funds = w["months"], w["funds"]
    n = len(months) - 1
    a = next(i for i, f in enumerate(funds) if f["sleeve"] == "arbitrage")
    units = [amount * f["weight"] / f["nav"][0] for f in funds]
    pay = amount * 0.003
    tax = _Tax(slab)
    fy, paid, payout_tax = _fy(months[0]), 0.0, 0.0
    flows = [-amount]
    ledger = [{"month": months[0], "payout": 0, "sold_from": "", "arb_units": round(units[a], 4),
               "value": round(sum(u * f["nav"][0] for u, f in zip(units, funds)), 2), "tax_paid": 0}]
    for i in range(1, n + 1):
        tax_now = 0.0
        if _fy(months[i]) != fy:
            tax_now = tax.tax(); payout_tax += tax_now; flows[-1] -= tax_now
            tax.reset(); fy = _fy(months[i])
        need, sold = pay, "arbitrage"
        arb_val = units[a] * funds[a]["nav"][i]
        take = min(need, arb_val)
        if take > 0:
            u = take / funds[a]["nav"][i]
            units[a] -= u
            tax.add("arbitrage", u * (funds[a]["nav"][i] - funds[a]["nav"][0]), i)
            need -= take
        if need > 1e-6:
            sold = "arbitrage + others" if take > 0 else "other funds"
            vals = [0 if k == a else units[k] * f["nav"][i] for k, f in enumerate(funds)]
            tot = sum(vals)
            for k, f in enumerate(funds):
                if k != a and vals[k] > 0:
                    r = min(vals[k], need * vals[k] / tot)
                    u = r / f["nav"][i]
                    units[k] -= u
                    tax.add(f["sleeve"], u * (f["nav"][i] - f["nav"][0]), i)
        paid += pay
        flows.append(pay)
        ledger.append({"month": months[i], "payout": round(pay, 2), "sold_from": sold, "arb_units": round(units[a], 4),
                       "value": round(sum(u * f["nav"][i] for u, f in zip(units, funds)), 2), "tax_paid": round(tax_now, 2)})
    last_tax = tax.tax()
    payout_tax += last_tax
    value = sum(u * f["nav"][n] for u, f in zip(units, funds))
    exit_t = tax.copy()
    for k, f in enumerate(funds):
        exit_t.add(f["sleeve"], units[k] * (f["nav"][n] - f["nav"][0]), n)
    exit_tax = max(0.0, exit_t.tax() - last_tax)
    flows[-1] += value - exit_tax - last_tax
    fd_month = amount * fd_rate / 1200 * (1 - slab / 100 * 1.04)
    arb_now = units[a] * funds[a]["nav"][n]
    return {
        "start": months[0], "end": months[-1], "months": n, "ledger": ledger,
        "headline": {
            "dvPaidGross": round(paid, 2), "dvPayoutTax": round(payout_tax, 2), "dvPaid": round(paid - payout_tax, 2),
            "dvValue": round(value, 2), "dvExitTax": round(exit_tax, 2), "dvTotal": round(paid - payout_tax + value, 2),
            "arbNowPct": round(arb_now / value * 100, 4) if value else 0, "dvIrr": _irr(flows),
            "fdPaid": round(fd_month * n, 2), "fdTotal": round(amount + fd_month * n, 2),
        },
    }


def sip_check(years: int, monthly: float, step: float, slab: float) -> dict:
    """Monthly SIP + yearly step-up, 3.6% of value paid at each year end (FIFO lots)."""
    w = _window(villa_funds(), years)
    months, funds = w["months"], w["funds"]
    n = len(months) - 1
    a = next(i for i, f in enumerate(funds) if f["sleeve"] == "arbitrage")
    lots = [[] for _ in funds]            # [units, nav, month]
    tax = _Tax(slab)
    fy = _fy(months[0])
    invested = income = income_tax = 0.0
    flows = [0.0] * (n + 1)
    ledger = []

    def held(k): return sum(l[0] for l in lots[k])
    def value(i): return sum(held(k) * f["nav"][i] for k, f in enumerate(funds))

    def sell(k, rupees, i):
        u = rupees / funds[k]["nav"][i]
        while u > 1e-12 and lots[k]:
            lot = lots[k][0]
            take = min(u, lot[0])
            tax.add(funds[k]["sleeve"], take * (funds[k]["nav"][i] - lot[1]), i - lot[2])
            lot[0] -= take; u -= take
            if lot[0] <= 1e-12: lots[k].pop(0)

    for i in range(n + 1):
        t_now = 0.0
        if _fy(months[i]) != fy:
            t_now = tax.tax(); income_tax += t_now; flows[i] -= t_now
            tax.reset(); fy = _fy(months[i])
        pay = 0.0
        if i > 0 and i % 12 == 0:
            pay = value(i) * 0.036
            need = pay
            take = min(need, held(a) * funds[a]["nav"][i])
            if take > 0: sell(a, take, i)
            need -= take
            if need > 1e-6:
                vals = [0 if k == a else held(k) * f["nav"][i] for k, f in enumerate(funds)]
                tot = sum(vals)
                for k in range(len(funds)):
                    if vals[k] > 0: sell(k, min(vals[k], need * vals[k] / tot), i)
            income += pay; flows[i] += pay
        amt = 0.0
        if i < n:
            amt = monthly * (1 + step / 100) ** (i // 12)
            for k, f in enumerate(funds):
                lots[k].append([amt * f["weight"] / f["nav"][i], f["nav"][i], i])
            invested += amt; flows[i] -= amt
        ledger.append({"month": months[i], "put_in": round(amt, 2), "payout": round(pay, 2),
                       "invested_so_far": round(invested, 2), "value": round(value(i), 2), "tax_paid": round(t_now, 2)})
    last_tax = tax.tax()
    income_tax += last_tax
    v = value(n)
    exit_t = tax.copy()
    for k, f in enumerate(funds):
        for lot in lots[k]:
            exit_t.add(f["sleeve"], lot[0] * (f["nav"][n] - lot[1]), n - lot[2])
    exit_tax = max(0.0, exit_t.tax() - last_tax)
    flows[n] += v - exit_tax - last_tax
    return {
        "start": months[0], "end": months[-1], "months": n, "ledger": ledger,
        "headline": {"invested": round(invested, 2), "value": round(v, 2), "exitTax": round(exit_tax, 2),
                     "valueAfterTax": round(v - exit_tax, 2), "incomeGross": round(income, 2),
                     "incomeTax": round(income_tax, 2), "income": round(income - income_tax, 2), "xirr": _irr(flows)},
    }


def flat_check(years: int, price: float, value: float, rent: float, stamp: float, slab: float) -> dict:
    """The flat side worked out by hand; the DigiVilla side = payout_check on the
    flat's all-in cost."""
    Y = max(1, years)
    outlay = price * (1 + (stamp + 1) / 100)
    app = (value / price) ** (1 / Y) - 1
    gross = upkeep = 0.0
    rows = []
    for t in range(1, Y + 1):
        r = rent * 11 / 1.05 ** (Y - t)
        u = 0.004 * price * (1 + app) ** t
        gross += r; upkeep += u
        rows.append({"year": t, "rent_collected": round(r, 2), "upkeep": round(u, 2)})
    rent_tax = gross * slab / 100 * 0.7 * 1.04
    kept = gross - rent_tax - upkeep
    dv = payout_check(Y, outlay, 0, slab)
    return {
        "start": dv["start"], "end": dv["end"], "months": dv["months"], "ledger": dv["ledger"], "flat_years": rows,
        "headline": {"outlay": round(outlay, 2), "appPct": round(app * 100, 4), "rentGross": round(gross, 2),
                     "rentTax": round(rent_tax, 2), "upkeep": round(upkeep, 2), "rentKept": round(kept, 2),
                     "flTotal": round(value + kept, 2), "dvPaid": dv["headline"]["dvPaid"],
                     "dvValue": dv["headline"]["dvValue"], "dvTotal": dv["headline"]["dvTotal"]},
    }
