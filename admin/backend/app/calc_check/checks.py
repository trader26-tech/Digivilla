"""The calculators, recomputed independently: FD / Lumpsum (payout_check), SIP
(sip_check) and Flat (flat_check) — compared figure by figure with the app's
own engine on the admin's Check the maths page."""

from __future__ import annotations

from app.calc_check.book import _Lots
from app.calc_check.data import _villa, _window, villa_funds
from app.calc_check.report import _month_detail, _rb, _rb_row, _snap, _story
from app.calc_check.settings import _cfg
from app.calc_check.tax import _Tax, _fy, _fy_label, _irr


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
