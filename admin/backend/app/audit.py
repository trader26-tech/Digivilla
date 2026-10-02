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
from app.calc_settings import calc_config
from app.config import get_settings


def _cfg() -> dict:
    """The calculator SETTINGS in force — the same object the app uses."""
    return calc_config.get()


def _villa_unit() -> float: return float(_cfg()["estate"]["villa_cost"])
def _finished_at() -> float: return _villa_unit() * 0.99      # a lumpsum buys ~₹4,99,975 after stamp duty
def _villa_income() -> float: return float(_cfg()["estate"]["villa_income_monthly"])
def _max_houses() -> int: return int(_cfg()["estate"]["plots"])
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


def _villa(pf: str) -> dict:
    """The history, weighted for one villa from the SETTINGS (series it doesn't hold get 0)."""
    cfg = _cfg()
    v = next((x for x in cfg["villas"] if x["key"] == pf), None) or next(x for x in cfg["villas"] if x["key"] == cfg["default_villa"])
    d = villa_funds()
    return {**d, "funds": [{**f, "weight": float(v["weights"].get(f["sleeve"], 0.0))} for f in d["funds"]]}


def data_used() -> dict:
    """Everything the calculators are fed: each series (what it is, where it comes
    from, its weight, first/last month), every month-end value, the rules."""
    d = villa_funds()
    series = []
    for f in d["funds"]:
        v = f["nav"]
        series.append({"sleeve": f["sleeve"], "name": f["name"], "source": f.get("source", ""),
                       "weight": f["weight"], "first": d["months"][0], "last": d["months"][-1],
                       "start_value": v[0], "end_value": v[-1],
                       "growth_x": round(v[-1] / v[0], 4) if v[0] else None,
                       "cagr": round(((v[-1] / v[0]) ** (12 / (len(v) - 1)) - 1) * 100, 2) if v[0] and len(v) > 1 else None})
    rows = [{"month": m, **{f["sleeve"]: f["nav"][i] for f in d["funds"]}} for i, m in enumerate(d["months"])]
    return {
        "basis": d.get("basis", "index"), "note": d.get("note"), "start": d["months"][0], "end": d["months"][-1],
        "series": series, "rows": rows,
        "rules": _rules_text(_cfg()),
    }


def _rules_text(c: dict) -> list[str]:
    """The rules, in words, written from the SETTINGS (so they can't drift)."""
    names = {"arbitrage": "arbitrage", "gold": "gold", "large": "Nifty 50", "mid": "Midcap 150", "small": "Smallcap 250"}
    nm = lambda xs: ", ".join(names.get(x, x) for x in xs)
    first = c["income"]["pay_first"]
    mix = lambda v: f"{round(100 - sum(v['weights'].get(k, 0) for k in first) * 100)}/{round(sum(v['weights'].get(k, 0) for k in first) * 100)}"
    t, w = c["tax"], c["withdrawals"]
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return [
        "Each part is its benchmark INDEX — no actively managed fund is used.",
        "Villas (growth / " + nm(first) + "): " + ", ".join(f"{v['name']} {mix(v)}" for v in c["villas"])
        + f". The weights shown are the default villa's ({c['default_villa']}).",
        "Month-end closes; only complete months.",
        f"SWP (FD / Lumpsum / Flat): {w['lumpsum_monthly_rate'] * 100:g}% of the amount a month (₹{1e7 * w['lumpsum_monthly_rate']:,.0f} per ₹1 Cr), "
        f"sold from {nm(first)} first, then the rest pro-rata. The tax on that sale comes out of the payout.",
        f"SIP: each month's amount buys every part by weight; with SWP on, {w['sip_yearly_rate'] * 100:g}% of the value is paid at each year end ({nm(first)} first).",
        f"Every 1 {months[c['rebalance']['month'] % 12]} (at the month-end close before it): {nm(first)} is left alone; "
        f"{nm(c['rebalance']['parts'])} go back to their starting split of (value − the tax on what that sells).",
        f"Sales take the oldest units first; each sale is charged the tax it adds to its financial year. Equity {t['equity_st_rate'] * 100:g}% ≤ {t['equity_lt_months']} months, "
        f"{t['equity_lt_rate'] * 100:g}% after (₹{t['equity_exempt']:,.0f} a year free); {nm(t['gold_parts'])} slab ≤ {t['gold_lt_months']} months, "
        f"{t['gold_lt_rate'] * 100:g}% after; +{t['cess'] * 100:g}% cess. No tax is taken off the final value.",
        "Index levels are before any fund's expense ratio.",
        f"Settings v{c.get('version')} · {c.get('updated_at', '')} · {c.get('updated_by', '')}",
    ]


def _window(d: dict, years: int) -> dict:
    months = d["months"]
    start = max(0, len(months) - 1 - 12 * years)
    return {"months": months[start:],
            "funds": [{**f, "nav": f["nav"][start:]} for f in d["funds"]]}


def _fy(ym: str) -> int:
    y, m = map(int, ym.split("-"))
    return y if m >= 4 else y - 1


class _Tax:
    """Gains realised in one financial year → tax, on the SETTINGS' rules."""
    def __init__(self, slab: float, rules: Optional[dict] = None):
        self.slab = slab
        self.r = rules or _cfg()["tax"]
        self.reset()

    def reset(self):
        self.eq_st = self.eq_lt = self.g_st = self.g_lt = 0.0

    def add(self, sleeve: str, gain: float, held_months: int):
        if sleeve in self.r["gold_parts"]:
            if held_months > self.r["gold_lt_months"]: self.g_lt += gain
            else: self.g_st += gain
        elif held_months > self.r["equity_lt_months"]:
            self.eq_lt += gain
        else:
            self.eq_st += gain

    def tax(self) -> float:
        st, lt = self.eq_st, self.eq_lt
        if st < 0 < lt:
            lt, st = max(0.0, lt + st), 0.0
        elif lt < 0 < st:
            st, lt = max(0.0, st + lt), 0.0
        r = self.r
        eq = max(0.0, st) * r["equity_st_rate"] + max(0.0, lt - r["equity_exempt"]) * r["equity_lt_rate"]
        gold = max(0.0, self.g_st) * self.slab / 100 + max(0.0, self.g_lt) * r["gold_lt_rate"]
        return (eq + gold) * (1 + r["cess"])

    def breakdown(self) -> dict:
        """The year's tax worked out line by line (same maths as tax())."""
        st, lt = self.eq_st, self.eq_lt
        if st < 0 < lt:
            lt, st = max(0.0, lt + st), 0.0
        elif lt < 0 < st:
            st, lt = max(0.0, st + lt), 0.0
        r = self.r
        m_eq, m_g = r["equity_lt_months"], r["gold_lt_months"]
        lines = [
            {"label": f"Equity short-term gains (held ≤ {m_eq} months)", "gain": self.eq_st, "taxable": max(0.0, st), "rate": r["equity_st_rate"] * 100},
            {"label": f"Equity long-term gains (held > {m_eq} months), after the ₹{r['equity_exempt']:,.0f} exemption", "gain": self.eq_lt,
             "taxable": max(0.0, lt - r["equity_exempt"]), "rate": r["equity_lt_rate"] * 100},
            {"label": f"Gold short-term gains (held ≤ {m_g} months), at your slab", "gain": self.g_st, "taxable": max(0.0, self.g_st), "rate": float(self.slab)},
            {"label": f"Gold long-term gains (held > {m_g} months)", "gain": self.g_lt, "taxable": max(0.0, self.g_lt), "rate": r["gold_lt_rate"] * 100},
        ]
        for l in lines:
            l["tax"] = round(l["taxable"] * l["rate"] / 100, 2)
            l["gain"], l["taxable"] = round(l["gain"], 2), round(l["taxable"], 2)
        before = sum(l["tax"] for l in lines)
        c = self.r["cess"]
        return {"lines": lines, "before_cess": round(before, 2), "cess": round(before * c, 2), "total": round(before * (1 + c), 2),
                "cess_pct": round(c * 100, 4)}

    def copy(self):
        t = _Tax(self.slab, self.r)
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


class _Lots:
    """Every purchase a lot [units, price, month]; sales oldest-first."""
    def __init__(self, funds, tax: _Tax):
        self.f, self.t = funds, tax
        self.lots = [[] for _ in funds]
        self.tag = "invest"                     # what the next buys/sells are for
        self.flows = [{"invest": 0.0, "payout": 0.0, "rebal_in": 0.0, "rebal_out": 0.0} for _ in funds]
        self.arb_rebal_moves = 0                # buys/sells of arbitrage made BY a rebalance (must stay 0)
        self._i = 0                             # the month the last snapshot was taken at
        self.ev = []                            # this month's operations, with their arithmetic
        self.charged = 0.0                      # tax charged so far this financial year
        cfg = _cfg()
        idx = lambda keys: [k for k in (next((j for j, f in enumerate(funds) if f["sleeve"] == s), -1) for s in keys) if k >= 0]
        self.pay_first = idx(cfg["income"]["pay_first"])
        self.rebal = [k for k in idx(cfg["rebalance"]["parts"]) if funds[k]["weight"] > 0]

    def units(self, k): return sum(l[0] for l in self.lots[k])
    def val(self, k, i): return self.units(k) * self.f[k]["nav"][i]
    def total(self, i): return sum(self.val(k, i) for k in range(len(self.f)))

    def buy(self, k, rupees, i):
        if rupees > 0:
            self.lots[k].append([rupees / self.f[k]["nav"][i], self.f[k]["nav"][i], i])
            self.ev.append({"op": "buy", "tag": self.tag, "sleeve": self.f[k]["sleeve"], "rupees": round(rupees, 2),
                            "nav": self.f[k]["nav"][i], "units": round(rupees / self.f[k]["nav"][i], 6)})
            self.flows[k]["rebal_in" if self.tag == "rebalance" else "invest"] += rupees
            if self.tag == "rebalance" and k in self.pay_first: self.arb_rebal_moves += 1

    def sell(self, k, rupees, i):
        self.flows[k]["rebal_out" if self.tag == "rebalance" else "payout"] += rupees
        if self.tag == "rebalance" and k in self.pay_first: self.arb_rebal_moves += 1
        u = rupees / self.f[k]["nav"][i]
        e = {"op": "sell", "tag": self.tag, "sleeve": self.f[k]["sleeve"], "rupees": round(rupees, 2),
             "nav": self.f[k]["nav"][i], "units": round(u, 6), "cost": 0.0, "gain_st": 0.0, "gain_lt": 0.0, "lots": []}
        r = self.t.r
        lim = r["gold_lt_months"] if self.f[k]["sleeve"] in r["gold_parts"] else r["equity_lt_months"]
        while u > 1e-12 and self.lots[k]:
            lot = self.lots[k][0]
            take = min(u, lot[0])
            g = take * (self.f[k]["nav"][i] - lot[1])
            self.t.add(self.f[k]["sleeve"], g, i - lot[2])
            e["cost"] += take * lot[1]
            e["gain_lt" if i - lot[2] > lim else "gain_st"] += g
            if len(e["lots"]) < 4:
                e["lots"].append({"units": round(take, 6), "bought_nav": lot[1], "held_months": i - lot[2], "gain": round(g, 2)})
            lot[0] -= take; u -= take
            if lot[0] <= 1e-12: self.lots[k].pop(0)
        for f in ("cost", "gain_st", "gain_lt"): e[f] = round(e[f], 2)
        self.ev.append(e)

    def tax_if(self, sells, i) -> float:
        """Tax these sales would ADD to the year so far (nothing is sold)."""
        t = self.t.copy()
        for k, r in enumerate(sells):
            u = r / self.f[k]["nav"][i] if r > 1e-9 else 0.0
            for lot in self.lots[k]:
                if u <= 1e-12:
                    break
                q = min(u, lot[0])
                t.add(self.f[k]["sleeve"], q * (self.f[k]["nav"][i] - lot[1]), i - lot[2])
                u -= q
        return max(0.0, t.tax() - self.charged)

    def charge(self) -> float:
        """After a sale: charge the tax it added to the year."""
        inc = max(0.0, self.t.tax() - self.charged)
        self.charged += inc
        return inc

    def close_year(self, i, a) -> float:
        """Financial year end: anything over-charged (a later loss) goes back into the quadrant."""
        credit = max(0.0, self.charged - self.t.tax())
        self.t.reset()
        self.charged = 0.0
        if credit > 0:
            g = self.rebal or [k for k in range(len(self.f)) if k not in self.pay_first]
            G = sum(self.val(k, i) for k in g)
            W = sum(self.f[k]["weight"] for k in g) or 1
            self.tag = "credit"
            for k in g:
                self.buy(k, credit * (self.val(k, i) / G if G > 0 else self.f[k]["weight"] / W), i)
            self.tag = "invest"
        return credit

    def pay(self, need, i, a=None) -> str:
        """Raise ₹need: the settings' pay-first parts in order, then everything else pro-rata."""
        self.tag = "payout"
        first_val = sum(self.val(k, i) for k in self.pay_first)
        self.ev.append({"op": "pay", "need": round(need, 2), "arb_value": round(first_val, 2)})
        took = 0.0
        for k in self.pay_first:
            take = min(need, self.val(k, i))
            if take > 0: self.sell(k, take, i)
            need -= take; took += take
        if need <= 1e-6:
            self.tag = "invest"
            return "arbitrage"
        vals = [0 if k in self.pay_first else self.val(k, i) for k in range(len(self.f))]
        tot = sum(vals)
        for k in range(len(self.f)):
            if vals[k] > 0: self.sell(k, min(vals[k], need * vals[k] / tot), i)
        self.tag = "invest"
        return "arbitrage + others" if took > 0 else "other funds"

    def rebalance(self, i, a):
        """1 January: the quadrant back to its split of (value − tax); arbitrage left alone."""
        g = self.rebal
        wsum = sum(self.f[k]["weight"] for k in g)
        before = [self.val(k, i) for k in range(len(self.f))]
        if len(g) < 2 or not wsum or not sum(before[k] for k in g):
            return None
        G = sum(before[k] for k in g)
        units_before = [self.units(k) for k in range(len(self.f))]

        def sells_for(tax):
            return [max(0.0, before[k] - (G - tax) * self.f[k]["weight"] / wsum) if k in g else 0.0 for k in range(len(self.f))]

        tax = 0.0
        for _ in range(30):                      # the tax depends on the sells, the sells on the tax
            t = self.tax_if(sells_for(tax), i)
            if abs(t - tax) < 1e-6:
                break
            tax = t
        target = {k: (G - tax) * self.f[k]["weight"] / wsum for k in g}
        self.ev.append({"op": "rebalance", "growth_total": round(G, 2), "tax": round(tax, 2), "after_tax": round(G - tax, 2),
                        "rows": [{"sleeve": self.f[k]["sleeve"], "before": round(before[k], 2),
                                  "share": round(self.f[k]["weight"] / wsum * 100, 4),
                                  "target": round(target[k], 2), "moved": round(target[k] - before[k], 2)} for k in g],
                        "arbitrage": round(before[a], 2) if a >= 0 else None})
        self.tag = "rebalance"
        sells = sells_for(tax)
        for k, r in enumerate(sells):
            if r > 1e-9: self.sell(k, r, i)
        paid = self.charge()
        cash = sum(sells) - paid
        need = {k: max(0.0, target[k] - before[k]) for k in g}
        n_tot = sum(need.values())
        for k in g:
            if need[k] > 0 and n_tot > 0: self.buy(k, cash * need[k] / n_tot, i)
        self.tag = "invest"
        after = [self.val(k, i) for k in range(len(self.f))]
        return {"units_before": units_before, "units_after": [self.units(k) for k in range(len(self.f))], "before": before,
                "after": after, "moved": [after[k] - before[k] for k in range(len(self.f))], "tax": paid}



def _snap(book, a):
    """One month's picture, after everything that month (for the story charts)."""
    n = len(book.f)
    return {"v": [book.val(k, book._i) for k in range(n)], "u": [book.units(k) for k in range(n)],
            "arb_paid": book.flows[a]["payout"] if a >= 0 else 0.0,
            "arb_inv": book.flows[a]["invest"] if a >= 0 else 0.0,
            "fl": [dict(f) for f in book.flows]}


def _month_detail(book, i, months, units_open, fy_tax=None, fy_label=None, extra=None) -> dict:
    """One month, written out: index values, units × index before and after,
    and every operation with its arithmetic."""
    f = book.f
    d = {"i": i, "month": months[i],
         "funds": [{"sleeve": x["sleeve"], "nav": x["nav"][i], "nav_prev": x["nav"][i - 1] if i else None,
                    "units_open": round(units_open[k], 6), "value_open": round(units_open[k] * x["nav"][i], 2),
                    "units_close": round(book.units(k), 6), "value_close": round(book.val(k, i), 2)} for k, x in enumerate(f)],
         "events": book.ev, "total_open": round(sum(units_open[k] * x["nav"][i] for k, x in enumerate(f)), 2),
         "total_close": round(book.total(i), 2)}
    if fy_tax is not None:
        d["fy_tax"] = {"fy": fy_label, **fy_tax}
    if extra:
        d.update(extra)
    book.ev = []
    return d


def _fy_label(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    s = y if mo >= 4 else y - 1
    return f"FY {s}-{str(s + 1)[2:]}"


def _monthly(funds, months, snaps, ledger) -> list:
    """Every month, per fund: ₹ value after that month, and what moved it —
    new money in, sold to pay you, bought/sold at the 1 January rebalance, and
    the market (whatever is left of the change)."""
    out = []
    for i, sn in enumerate(snaps):
        row = {"month": months[i], "total": round(sum(sn["v"]), 2),
               "payout": ledger[i].get("payout", 0), "tax_paid": ledger[i].get("tax_paid", 0),
               "rebalanced": bool(ledger[i].get("rebalanced")), "f": {}}
        for k, f in enumerate(funds):
            cur, prev = sn["fl"][k], (snaps[i - 1]["fl"][k] if i else {"invest": 0, "payout": 0, "rebal_in": 0, "rebal_out": 0})
            inv = cur["invest"] - prev["invest"]
            paid = cur["payout"] - prev["payout"]
            rb = (cur["rebal_in"] - prev["rebal_in"]) - (cur["rebal_out"] - prev["rebal_out"])
            v_prev = snaps[i - 1]["v"][k] if i else 0.0
            row["f"][f["sleeve"]] = {"v": round(sn["v"][k], 2), "inv": round(inv, 2), "paid": round(paid, 2),
                                     "rb": round(rb, 2), "mkt": round(sn["v"][k] - v_prev - inv + paid - rb, 2)}
        out.append(row)
    return out


def _story(funds, months, book, a, snaps, rb_raw, sip=False, ledger=None) -> dict:
    """What the money did, in a form the admin can chart and check: each sleeve's
    index CAGR and flows, every month's value per sleeve, and every 1 January —
    how much each index moved since the last one, the drift it caused, what was
    bought/sold, and proof that arbitrage was never touched."""
    n = len(months) - 1
    yrs = n / 12 if n else 1
    growth = [k for k in range(len(funds)) if k != a]
    wsum = sum(funds[k]["weight"] for k in growth) or 1
    sleeves = []
    for k, f in enumerate(funds):
        nav, fl = f["nav"], book.flows[k]
        gx = nav[n] / nav[0]
        sleeves.append({
            "sleeve": f["sleeve"], "name": f["name"], "weight": f["weight"],
            "target_growth_share": None if k == a else round(f["weight"] / wsum * 100, 2),
            "index_start": nav[0], "index_end": nav[n], "index_growth_x": round(gx, 4),
            "index_cagr": round((gx ** (1 / yrs) - 1) * 100, 2),
            "invested": round(fl["invest"], 2), "paid_out": round(fl["payout"], 2),
            "rebal_in": round(fl["rebal_in"], 2), "rebal_out": round(fl["rebal_out"], 2),
            "rebal_net": round(fl["rebal_in"] - fl["rebal_out"], 2),
            "value_now": round(book.val(k, n), 2),
        })
    years, prev = [], 0
    for i, r in rb_raw:
        gb = sum(r["before"][k] for k in growth) or 1
        ga = sum(r["after"][k] for k in growth) or 1
        years.append({
            "month": months[i], "label": f"1 Jan {int(months[i][:4]) + 1}", "since": months[prev],
            "funds": [{
                "sleeve": f["sleeve"],
                "index_ret": round((f["nav"][i] / f["nav"][prev] - 1) * 100, 2),
                "before": round(r["before"][k], 2), "after": round(r["after"][k], 2), "moved": round(r["moved"][k], 2),
                "units_before": round(r["units_before"][k], 4), "units_after": round(r["units_after"][k], 4),
                "share_before": None if k == a else round(r["before"][k] / gb * 100, 2),
                "share_after": None if k == a else round(r["after"][k] / ga * 100, 2),
                "target": None if k == a else round(f["weight"] / wsum * 100, 2),
            } for k, f in enumerate(funds)],
            "arb_paid_since": round(snaps[i]["arb_paid"] - snaps[prev]["arb_paid"], 2) if a >= 0 else 0,
            "turnover": round(sum(m for m in r["moved"] if m > 0), 2),
            "tax": round(r["tax"], 2),
        })
        prev = i
    # ── the checks the admin asked for ──
    arb_same = all(abs(r["before"][a] - r["after"][a]) < 0.01 and abs(r["units_before"][a] - r["units_after"][a]) < 1e-9
                   for _, r in rb_raw) and book.arb_rebal_moves == 0
    u = [sn["u"][a] for sn in snaps]
    rises = [months[i] for i in range(1, len(u)) if u[i] > u[i - 1] + 1e-9]
    # SIP: any rise in arbitrage units must be fully explained by that month's new SIP money
    unexplained = [months[i] for i in range(1, len(u))
                   if u[i] - u[i - 1] > (snaps[i]["arb_inv"] - snaps[i - 1]["arb_inv"]) / funds[a]["nav"][i] + 1e-6]
    worst = max((abs(fr["share_after"] - fr["target"]) for y in years for fr in y["funds"] if fr["target"] is not None), default=0)
    net = max((abs(sum(fr["moved"] for fr in y["funds"]) + y["tax"]) for y in years), default=0)
    checks = [
        {"ok": arb_same, "label": "Arbitrage never bought or sold at a 1 January rebalance",
         "detail": f"{len(rb_raw)} rebalances · arbitrage units and ₹ identical before and after every one"},
        ({"ok": not unexplained, "label": "Arbitrage units only grow with new SIP money — payouts and rebalances never add to it",
          "detail": (f"each instalment buys today's split, so {funds[a]['weight'] * 100:g}% goes to arbitrage; the yearly income is sold from it first"
                     if not unexplained else f"unexplained rise in {', '.join(unexplained[:5])}")}
         if sip else
         {"ok": not rises, "label": "Arbitrage units only ever go down (paid out each month, never topped up)",
          "detail": "no month where arbitrage units rose" if not rises else f"rose in {', '.join(rises[:5])}"}),
        {"ok": worst < 0.01, "label": "After every rebalance the quadrant is back to 25% each",
         "detail": "target " + " : ".join(f"{sl['target_growth_share']:g}%" for sl in sleeves if sl["target_growth_share"] is not None)
                   + f" · worst miss {worst:.4f} pts"},
        {"ok": net < 1, "label": "A rebalance only moves money inside the quadrant — out only its tax",
         "detail": f"largest |Σ moved + tax| ₹{net:,.2f}"},
    ]
    return {
        "sleeves": sleeves, "years": years, "checks": checks,
        "monthly": _monthly(funds, months, snaps, ledger) if ledger else [],
        "series": {"months": months, "values": {f["sleeve"]: [round(sn["v"][k]) for sn in snaps] for k, f in enumerate(funds)},
                   "arb_units": [round(x, 4) for x in u],
                   "rebalance_months": [months[i] for i, _ in rb_raw]},
    }


def _rb(months, i): return i > 0 and int(months[i][5:7]) == int(_cfg()["rebalance"]["month"])


def _rb_row(funds, months, i, r):
    return {"month": months[i], "funds": [
        {"name": f["name"], "sleeve": f["sleeve"], "before": round(r["before"][k], 2),
         "after": round(r["after"][k], 2), "moved": round(r["moved"][k], 2),
         "share_before": round(r["before"][k] / sum(r["before"]) * 100, 2) if sum(r["before"]) else 0,
         "share_after": round(r["after"][k] / sum(r["after"]) * 100, 2) if sum(r["after"]) else 0}
        for k, f in enumerate(funds)], "tax": round(r["tax"], 2)}


def payout_check(years: int, amount: float, fd_rate: float, slab: float, pf: str = "balanced", swp: bool = True) -> dict:
    """A lumpsum in one villa; with SWP on, ₹30,000/month per ₹1 Cr sold from
    arbitrage first (FD vs DigiVilla, Lumpsum, and the DigiVilla side of Flat);
    the quadrant reset to 25% each every 1 January, its tax paid from the proceeds."""
    w = _window(_villa(pf), years)
    months, funds = w["months"], w["funds"]
    n = len(months) - 1
    first = _cfg()["income"]["pay_first"]      # the part the income comes from first (arbitrage today)
    a = next((i for i, f in enumerate(funds) if f["sleeve"] in first), 0)
    tax = _Tax(slab)
    book = _Lots(funds, tax)
    for k, f in enumerate(funds):
        book.buy(k, amount * f["weight"], 0)
    book._i = 0
    snaps, rb_raw = [_snap(book, a)], []
    detail = [_month_detail(book, 0, months, [0.0] * len(funds))]
    yearly, year_paid = [], 0.0
    cfg = _cfg()
    pay = amount * cfg["withdrawals"]["lumpsum_monthly_rate"] if swp else 0.0
    fy, paid, pay_tax, rebal_tax = _fy(months[0]), 0.0, 0.0, 0.0
    flows = [-amount]
    rebalances = []
    ledger = [{"month": months[0], "payout": 0, "sold_from": "", "arb_units": round(book.units(a), 4),
               "rebalanced": "", "value": round(book.total(0), 2), "tax_paid": 0}]
    for i in range(1, n + 1):
        units_open = [book.units(k) for k in range(len(funds))]
        fy_tax = fy_lab = None
        credit = 0.0
        if _fy(months[i]) != fy:
            fy_tax, fy_lab = tax.breakdown(), _fy_label(months[i - 1])
            credit = book.close_year(i, a)
            fy = _fy(months[i])
        sold, t_pay, net = "", 0.0, 0.0
        if pay > 0:
            sold = book.pay(pay, i, a)
            t_pay = book.charge()
            book.ev.append({"op": "pay_tax", "tax": round(t_pay, 2), "net": round(pay - t_pay, 2)})
            paid += pay; pay_tax += t_pay; net = pay - t_pay
        flows.append(net)
        rb, t_rb = "", 0.0
        if _rb(months, i):
            r = book.rebalance(i, a)
            if r:
                rebalances.append(_rb_row(funds, months, i, r))
                rb_raw.append((i, r))
                rb, t_rb = "yes", r["tax"]
                rebal_tax += t_rb
        book._i = i
        snaps.append(_snap(book, a))
        detail.append(_month_detail(book, i, months, units_open, fy_tax, fy_lab,
                                    {"paid_so_far": round(paid, 2), "tax_paid_so_far": round(pay_tax + rebal_tax, 2),
                                     "income_net_so_far": round(paid - pay_tax, 2), "credit": round(credit, 2)}))
        year_paid += pay
        if i % 12 == 0:                                   # a year since the start: what the app's column shows
            v = book.total(i)
            yearly.append({"year": i // 12, "month": months[i], "value": round(v, 2), "payout": round(year_paid, 2),
                           "income": round(paid - pay_tax, 2),
                           "funds": {f["sleeve"]: round(book.val(k, i), 2) for k, f in enumerate(funds)},
                           "arb_units": round(book.units(a), 4)})
            year_paid = 0.0
        ledger.append({"month": months[i], "payout": round(pay, 2), "sold_from": sold, "arb_units": round(book.units(a), 4),
                       "rebalanced": rb, "value": round(book.total(i), 2), "tax_paid": round(t_pay + t_rb, 2)})
    value = book.total(n)
    flows[-1] += value
    fd_month = amount * fd_rate / 1200 * (1 - slab / 100 * (1 + cfg["tax"]["cess"]))
    arb_now = book.val(a, n)
    return {
        "start": months[0], "end": months[-1], "months": n, "ledger": ledger, "rebalances": rebalances,
        "villa": pf, "swp": swp,
        "story": _story(funds, months, book, a, snaps, rb_raw, ledger=ledger),
        "start_funds": {f["sleeve"]: round(amount * f["weight"], 2) for f in funds},
        "yearly": yearly, "detail": detail, "fy_open_tax": tax.breakdown(),
        "headline": {
            "dvPaidGross": round(paid, 2), "dvPayoutTax": round(pay_tax, 2), "dvPaid": round(paid - pay_tax, 2),
            "dvRebalanceTax": round(rebal_tax, 2),
            "dvValue": round(value, 2), "dvTotal": round(paid - pay_tax + value, 2),
            "arbNowPct": round(arb_now / value * 100, 4) if value else 0, "dvIrr": _irr(flows),
            "rebalances": len(rebalances),
            "fdPaid": round(fd_month * n, 2), "fdTotal": round(amount + fd_month * n, 2),
        },
    }


def sip_check(years: int, monthly: float, step: float, slab: float, pf: str = "balanced", swp: bool = True) -> dict:
    """Monthly SIP + yearly step-up into one villa; with SWP on, 3.6% of the value
    paid at each year end (arbitrage first); the quadrant reset every 1 January."""
    w = _window(_villa(pf), years)
    months, funds = w["months"], w["funds"]
    n = len(months) - 1
    first = _cfg()["income"]["pay_first"]      # the part the income comes from first (arbitrage today)
    a = next((i for i, f in enumerate(funds) if f["sleeve"] in first), 0)
    tax = _Tax(slab)
    book = _Lots(funds, tax)
    fy = _fy(months[0])
    invested = income = income_tax = rebal_tax = 0.0
    flows = [0.0] * (n + 1)
    ledger, rebalances = [], []
    snaps, rb_raw, yearly = [], [], []
    detail = []
    for i in range(n + 1):
        units_open = [book.units(k) for k in range(len(funds))]
        fy_tax = fy_lab = None
        credit = 0.0
        if _fy(months[i]) != fy:
            fy_tax, fy_lab = tax.breakdown(), _fy_label(months[i - 1])
            credit = book.close_year(i, a)
            fy = _fy(months[i])
        pay = t_pay = 0.0
        if swp and i > 0 and i % 12 == 0:
            pay = book.total(i) * _cfg()["withdrawals"]["sip_yearly_rate"]
            book.pay(pay, i, a)
            t_pay = book.charge()
            book.ev.append({"op": "pay_tax", "tax": round(t_pay, 2), "net": round(pay - t_pay, 2)})
            income += pay; income_tax += t_pay; flows[i] += pay - t_pay
        rb, t_rb = "", 0.0
        if _rb(months, i):
            r = book.rebalance(i, a)
            if r:
                rebalances.append(_rb_row(funds, months, i, r))
                rb_raw.append((i, r))
                rb, t_rb = "yes", r["tax"]
                rebal_tax += t_rb
        if i > 0 and i % 12 == 0:                         # what the app's year column shows
            yearly.append({"year": i // 12, "month": months[i], "invested": round(invested, 2), "value": round(book.total(i), 2),
                           "payout": round(pay, 2),
                           "funds": {f["sleeve"]: round(book.val(k, i), 2) for k, f in enumerate(funds)}})
        amt = 0.0
        if i < n:
            amt = monthly * (1 + step / 100) ** (i // 12)
            for k, f in enumerate(funds):
                book.buy(k, amt * f["weight"], i)
            invested += amt; flows[i] -= amt
        book._i = i
        snaps.append(_snap(book, a))
        detail.append(_month_detail(book, i, months, units_open, fy_tax, fy_lab,
                                    {"invested_so_far": round(invested, 2), "instalment": round(amt, 2), "income_paid": round(pay, 2),
                                     "credit": round(credit, 2)}))
        ledger.append({"month": months[i], "put_in": round(amt, 2), "payout": round(pay, 2), "rebalanced": rb,
                       "invested_so_far": round(invested, 2), "value": round(book.total(i), 2), "tax_paid": round(t_pay + t_rb, 2)})
    v = book.total(n)
    flows[n] += v
    return {
        "start": months[0], "end": months[-1], "months": n, "ledger": ledger, "rebalances": rebalances,
        "villa": pf, "swp": swp,
        "story": _story(funds, months, book, a, snaps, rb_raw, sip=True, ledger=ledger),
        "yearly": yearly, "detail": detail,
        "headline": {"invested": round(invested, 2), "value": round(v, 2), "incomeGross": round(income, 2),
                     "incomeTax": round(income_tax, 2), "income": round(income - income_tax, 2),
                     "rebalanceTax": round(rebal_tax, 2), "xirr": _irr(flows), "rebalances": len(rebalances)},
    }


def flat_check(years: int, price: float, value: float, rent: float, stamp: float, slab: float,
               pf: str = "balanced", swp: bool = True) -> dict:
    """The flat side worked out by hand; the DigiVilla side = payout_check on the
    flat's all-in cost."""
    F, cess = _cfg()["flat"], _cfg()["tax"]["cess"]
    stamp = F["stamp_pct"]                            # the settings decide, like the app
    Y = max(1, years)
    outlay = price * (1 + (stamp + F["registration_pct"]) / 100)
    app = (value / price) ** (1 / Y) - 1
    gross = upkeep = 0.0
    rows = []
    for t in range(1, Y + 1):
        r = rent * (12 - F["vacant_months"]) / (1 + F["rent_rise_pct"] / 100) ** (Y - t)
        u = F["upkeep_pct"] / 100 * price * (1 + app) ** t
        gross += r; upkeep += u
        rows.append({"year": t, "rent_collected": round(r, 2), "upkeep": round(u, 2)})
    rent_tax = gross * slab / 100 * (1 - F["std_deduction"]) * (1 + cess)
    kept = gross - rent_tax - upkeep
    dv = payout_check(Y, outlay, 0, slab, pf, swp)
    return {
        "start": dv["start"], "end": dv["end"], "months": dv["months"], "ledger": dv["ledger"], "flat_years": rows,
        "villa": pf, "swp": swp, "rebalances": dv["rebalances"], "story": dv["story"], "yearly": dv["yearly"], "start_funds": dv["start_funds"], "detail": dv["detail"],
        "headline": {"outlay": round(outlay, 2), "appPct": round(app * 100, 4), "rentGross": round(gross, 2),
                     "rentTax": round(rent_tax, 2), "upkeep": round(upkeep, 2), "rentKept": round(kept, 2),
                     "flTotal": round(value + kept, 2), "dvPaid": dv["headline"]["dvPaid"],
                     "dvValue": dv["headline"]["dvValue"], "dvTotal": dv["headline"]["dvTotal"]},
    }
