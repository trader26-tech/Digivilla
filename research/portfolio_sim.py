"""One function for every DigiVilla portfolio mix, on one daily CSV.

    simulate(quadrant_ratio, arbitrage_ratio, monthly_income=0.003)

reads `22_quadrant_jan_rebalance_and_arbitrage_daily.csv` (Gold BeES, Nifty 50
TRI, Nifty Midcap 150 TRI, Nifty Smallcap 250 TRI, Nifty 50 Arbitrage — daily)
and works out, day by day:

  quadrant   quadrant_ratio of the money, 25% each in gold / large / mid / small,
             put back to 25% each on 1 January every year (if 1 Jan isn't a
             trading day, at the last close before it). The tax on what that
             sells is paid out of the proceeds, so the quadrant resets to 25%
             each of (value − tax).
  arbitrage  arbitrage_ratio of the money. Never rebalanced. The monthly income
             is sold from it first; once it's empty, from the quadrant pro-rata.
  income     monthly_income × the amount invested, on the first trading day of
             every month after the start (default 0.3% → ₹30,000 a month per
             ₹1 Cr; 0 = no income). Tax on the gain sold to pay it comes out of
             the payout: you receive gross − tax.

Tax, today's rules for every year, per Indian financial year (Apr–Mar):
  equity (large / mid / small / arbitrage): held ≤ 12 months 20%; > 12 months
  12.5% above the ₹1,25,000 a year exemption. Gold BeES (a listed ETF): ≤ 12
  months at your slab; > 12 months 12.5%. Short- and long-term gains and losses
  net off within equity. + 4% cess. Each sale is charged the tax it ADDS to the
  year so far (so the exemption is used up in order); if a later loss in the
  same year lowers the bill, the difference is credited back at the year end.
  No tax is taken off the final value: it is what is still invested (the tax on
  every rebalance and every income sale has already been paid along the way).

Every purchase is a lot (units, price, date); sales are oldest-first (FIFO).

Run:
    python research/portfolio_sim.py --quadrant 0.64 --arbitrage 0.36
    python research/portfolio_sim.py --preset balanced_income --out balanced.csv
    python research/portfolio_sim.py --all-presets --start-date 2016-01-01
    simulate(0.64, 0.36, 0.003, "2016-01-01")   # quadrant, arbitrage, income, start date
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

DEFAULT_CSV = Path(__file__).resolve().parent.parent / "22_quadrant_jan_rebalance_and_arbitrage_daily.csv"

# the CSV column for each part
COLUMNS = {
    "gold": "goldbees_price",
    "large": "nifty50_tri",
    "mid": "nifty_midcap150_tri",
    "small": "nifty_smallcap250_tri",
    "arbitrage": "nifty50_arbitrage_index",
}
QUADRANT = ("gold", "large", "mid", "small")
PARTS = QUADRANT + ("arbitrage",)

# ── the 6 funds (quadrant / arbitrage): aggressive 80/20 · balanced 64/36 · conservative 30/70 ──
PRESETS = {
    "aggressive_income":     dict(quadrant_ratio=0.80, arbitrage_ratio=0.20, monthly_income=0.003),
    "aggressive":            dict(quadrant_ratio=0.80, arbitrage_ratio=0.20, monthly_income=0.0),
    "balanced_income":       dict(quadrant_ratio=0.64, arbitrage_ratio=0.36, monthly_income=0.003),
    "balanced":              dict(quadrant_ratio=0.64, arbitrage_ratio=0.36, monthly_income=0.0),
    "conservative_income":   dict(quadrant_ratio=0.30, arbitrage_ratio=0.70, monthly_income=0.003),
    "conservative":          dict(quadrant_ratio=0.30, arbitrage_ratio=0.70, monthly_income=0.0),
}

EQ_EXEMPT = 125_000
CESS = 1.04


# ─────────────────────────────── data ───────────────────────────────
def load(csv_path=DEFAULT_CSV, start: Optional[str] = None, end: Optional[str] = None):
    """[(date, {part: value})] for the trading days in [start, end]."""
    out = []
    with open(csv_path, newline="") as fh:
        for r in csv.DictReader(fh):
            d = r["date"]
            if (start and d < start) or (end and d > end):
                continue
            out.append((date.fromisoformat(d), {p: float(r[c]) for p, c in COLUMNS.items()}))
    if len(out) < 2:
        raise ValueError("Not enough days in that range.")
    return out


def _plus_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    raise ValueError(d)


def _long_term(bought: date, sold: date) -> bool:
    """Held MORE than 12 months."""
    return sold > _plus_months(bought, 12)


def _fy(d: date) -> int:
    """Financial year by its starting calendar year (Apr–Mar)."""
    return d.year if d.month >= 4 else d.year - 1


def rebalance_days(days: list, rule: str = "jan1") -> dict:
    """{day index: label} — when the quadrant goes back to 25% each.
    'jan1': 1 January itself, or the last close before it if it isn't a
    trading day. 'first_trading_day': the first trading day of January (the
    CSV's own timing; for checking against it)."""
    out = {}
    dates = [d for d, _ in days]
    for y in range(dates[0].year + 1, dates[-1].year + 1):
        jan1 = date(y, 1, 1)
        if rule == "jan1":
            idx = max((i for i, d in enumerate(dates) if d <= jan1), default=None)
        elif rule == "first_trading_day":
            idx = min((i for i, d in enumerate(dates) if d >= jan1), default=None)
        else:
            raise ValueError("rebalance_day must be 'jan1' or 'first_trading_day'")
        if idx is not None and idx > 0:
            out[idx] = f"1 Jan {y}" if rule == "jan1" else f"{dates[idx].isoformat()} (first trading day)"
    return out


# ─────────────────────────────── tax ───────────────────────────────
class TaxYear:
    """Gains realised in one financial year → tax, on today's rules."""

    def __init__(self, slab: float):
        self.slab = slab
        self.eq_st = self.eq_lt = self.g_st = self.g_lt = 0.0

    def copy(self) -> "TaxYear":
        t = TaxYear(self.slab)
        t.eq_st, t.eq_lt, t.g_st, t.g_lt = self.eq_st, self.eq_lt, self.g_st, self.g_lt
        return t

    def add(self, part: str, gain: float, long_term: bool) -> None:
        if part == "gold":
            if long_term: self.g_lt += gain
            else: self.g_st += gain
        elif long_term:
            self.eq_lt += gain
        else:
            self.eq_st += gain

    def tax(self) -> float:
        st, lt = self.eq_st, self.eq_lt
        if st < 0 < lt:
            lt, st = max(0.0, lt + st), 0.0
        elif lt < 0 < st:
            st, lt = max(0.0, st + lt), 0.0
        eq = max(0.0, st) * 0.20 + max(0.0, lt - EQ_EXEMPT) * 0.125
        gold = max(0.0, self.g_st) * self.slab / 100 + max(0.0, self.g_lt) * 0.125
        return (eq + gold) * CESS


# ─────────────────────────────── the book ───────────────────────────────
class Book:
    """Lots per part (FIFO), the financial year's gains, and what's been charged."""

    def __init__(self, slab: float, taxes: bool):
        self.lots = {p: [] for p in PARTS}          # [units, price, date]
        self.year = TaxYear(slab)
        self.charged = 0.0                          # tax charged so far this financial year
        self.slab, self.taxes = slab, taxes

    def units(self, p): return sum(l[0] for l in self.lots[p])
    def val(self, p, px): return self.units(p) * px[p]
    def total(self, px, parts=PARTS): return sum(self.val(p, px) for p in parts)

    def buy(self, p, rupees, px, d):
        if rupees > 1e-9:
            self.lots[p].append([rupees / px[p], px[p], d])

    def _walk(self, p, rupees, px, d, take_it: bool, year: TaxYear):
        """Sell ₹rupees of part p oldest-first, booking the gains into `year`."""
        u = rupees / px[p]
        lots = self.lots[p] if take_it else [l[:] for l in self.lots[p]]
        while u > 1e-12 and lots:
            lot = lots[0]
            q = min(u, lot[0])
            year.add(p, q * (px[p] - lot[1]), _long_term(lot[2], d))
            lot[0] -= q
            u -= q
            if lot[0] <= 1e-12:
                lots.pop(0)

    def sell(self, p, rupees, px, d):
        if rupees > 1e-9:
            self._walk(p, rupees, px, d, True, self.year)

    def tax_if(self, sells: dict, px, d) -> float:
        """Tax these sales would ADD to the year so far (nothing is sold)."""
        if not self.taxes:
            return 0.0
        y = self.year.copy()
        for p, r in sells.items():
            if r > 1e-9:
                self._walk(p, r, px, d, False, y)
        return max(0.0, y.tax() - self.charged)

    def charge(self) -> float:
        """After a sale: charge the tax it added to the year."""
        if not self.taxes:
            return 0.0
        inc = max(0.0, self.year.tax() - self.charged)
        self.charged += inc
        return inc

    def close_year(self) -> float:
        """Financial year end: anything over-charged (a later loss) comes back."""
        credit = max(0.0, self.charged - self.year.tax()) if self.taxes else 0.0
        self.year = TaxYear(self.slab)
        self.charged = 0.0
        return credit


# ─────────────────────────────── result ───────────────────────────────
@dataclass
class Result:
    params: dict
    daily: list = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    rebalances: list = field(default_factory=list)

    def to_csv(self, path) -> None:
        with open(path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(self.daily[0].keys()))
            w.writeheader()
            w.writerows(self.daily)


def _xirr(flows: list) -> Optional[float]:
    """flows = [(date, amount)] → annual rate, %."""
    t0 = flows[0][0]

    def npv(r):
        return sum(a / (1 + r) ** ((d - t0).days / 365.0) for d, a in flows)

    lo, hi = -0.99, 5.0
    if npv(lo) * npv(hi) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0: hi = mid
        else: lo = mid
    return (lo + hi) / 2 * 100


# ─────────────────────────────── the simulation ───────────────────────────────
def simulate(quadrant_ratio: float, arbitrage_ratio: float, monthly_income: float = 0.003,
             start_date: Optional[str] = None, *,
             amount: float = 1e7, slab: float = 30, csv_path=DEFAULT_CSV,
             end: Optional[str] = None, rebalance_day: str = "jan1", taxes: bool = True,
             start: Optional[str] = None) -> Result:
    """Simulate one portfolio mix.
    `monthly_income` is a fraction of `amount` per month (0.003 = 0.3%); 0 = no income.
    `start_date` 'YYYY-MM-DD' = the day the money goes in (the first trading day
    on or after it); None = the first day in the CSV. `end` cuts the run short.
    `taxes=False` switches tax off (only for checking against a pre-tax series).
    (`start` is the old name of `start_date`, still accepted.)"""
    if abs(quadrant_ratio + arbitrage_ratio - 1) > 1e-9:
        raise ValueError(f"quadrant_ratio + arbitrage_ratio must be 1 (got {quadrant_ratio + arbitrage_ratio}).")
    if quadrant_ratio < 0 or arbitrage_ratio < 0 or monthly_income < 0:
        raise ValueError("Ratios and income can't be negative.")
    start_date = start_date or start
    if start_date:
        try:
            start_date = date.fromisoformat(str(start_date)).isoformat()
        except ValueError:
            raise ValueError(f"start_date must be YYYY-MM-DD (got {start_date!r}).")

    days = load(csv_path, start_date, end)
    rb_at = rebalance_days(days, rebalance_day)
    book = Book(slab, taxes)
    res = Result(params=dict(quadrant_ratio=quadrant_ratio, arbitrage_ratio=arbitrage_ratio,
                             monthly_income=monthly_income, amount=amount, slab=slab,
                             start=days[0][0].isoformat(), end=days[-1][0].isoformat(),
                             rebalance_day=rebalance_day, taxes=taxes))

    d0, px0 = days[0]
    for p in QUADRANT:
        book.buy(p, amount * quadrant_ratio / 4, px0, d0)
    book.buy("arbitrage", amount * arbitrage_ratio, px0, d0)

    pay = amount * monthly_income
    flows = [(d0, -amount)]
    totals = dict(income_gross=0.0, income_tax=0.0, income_net=0.0, rebalance_tax=0.0, tax_credit=0.0, payouts=0)
    arb_empty: Optional[str] = None
    peak = dd = 0.0

    for i, (d, px) in enumerate(days):
        income_gross = income_tax = rebalance_tax = credit = 0.0
        rb_label = ""
        if i > 0:
            prev = days[i - 1][0]
            # 1 · a financial year closed
            if _fy(d) != _fy(prev):
                credit = book.close_year()
                if credit > 0:
                    q = book.total(px, QUADRANT) or 1
                    for p in QUADRANT:
                        book.buy(p, credit * (book.val(p, px) / q if q else 0.25), px, d)
            # 2 · this month's income (first trading day of each new month)
            if pay > 0 and (d.year, d.month) != (prev.year, prev.month):
                need = min(pay, book.total(px))
                arb = book.val("arbitrage", px)
                take = min(need, arb)
                book.sell("arbitrage", take, px, d)
                rest = need - take
                if rest > 1e-6:
                    if arb_empty is None:
                        arb_empty = d.isoformat()
                    q = book.total(px, QUADRANT)
                    for p in QUADRANT:
                        v = book.val(p, px)
                        if v > 0 and q > 0:
                            book.sell(p, min(v, rest * v / q), px, d)
                income_gross = need
                income_tax = book.charge()
                net = need - income_tax
                flows.append((d, net))
                totals["income_gross"] += need
                totals["income_tax"] += income_tax
                totals["income_net"] += net
                totals["payouts"] += 1
            # 3 · 1 January: the quadrant back to 25% each of (value − tax)
            if i in rb_at:
                rb_label = rb_at[i]
                before = {p: book.val(p, px) for p in QUADRANT}
                q = sum(before.values())
                tax_est = 0.0
                for _ in range(30):                      # tax depends on the sells, the sells on the tax
                    target = (q - tax_est) / 4
                    sells = {p: max(0.0, before[p] - target) for p in QUADRANT}
                    t = book.tax_if(sells, px, d)
                    if abs(t - tax_est) < 1e-6:
                        break
                    tax_est = t
                target = (q - tax_est) / 4
                sells = {p: max(0.0, before[p] - target) for p in QUADRANT}
                for p, r in sells.items():
                    book.sell(p, r, px, d)
                rebalance_tax = book.charge()
                cash = sum(sells.values()) - rebalance_tax
                need = {p: max(0.0, target - before[p]) for p in QUADRANT}
                n_tot = sum(need.values())
                for p in QUADRANT:
                    book.buy(p, cash * need[p] / n_tot if n_tot > 0 else 0.0, px, d)
                after = {p: book.val(p, px) for p in QUADRANT}
                res.rebalances.append({
                    "label": rb_label, "date": d.isoformat(), "quadrant_before": round(q, 2), "tax": round(rebalance_tax, 2),
                    "before": {p: round(before[p], 2) for p in QUADRANT}, "after": {p: round(after[p], 2) for p in QUADRANT},
                    "moved": {p: round(after[p] - before[p], 2) for p in QUADRANT},
                    "arbitrage_untouched": round(book.val("arbitrage", px), 2)})
                totals["rebalance_tax"] += rebalance_tax
            totals["tax_credit"] += credit

        vals = {p: book.val(p, px) for p in PARTS}
        total = sum(vals.values())
        qv = sum(vals[p] for p in QUADRANT)
        wealth = total + totals["income_net"]            # still invested + income received
        peak = max(peak, wealth)
        dd = max(dd, (peak - wealth) / peak if peak else 0.0)
        res.daily.append({
            "date": d.isoformat(),
            **{p: round(vals[p], 2) for p in PARTS},
            "quadrant": round(qv, 2), "total": round(total, 2),
            **{f"w_{p}": round(vals[p] / qv, 6) if qv else 0.0 for p in QUADRANT},
            "w_arbitrage_of_total": round(vals["arbitrage"] / total, 6) if total else 0.0,
            "arbitrage_units": round(book.units("arbitrage"), 6),
            "income_gross": round(income_gross, 2), "income_tax": round(income_tax, 2),
            "income_net": round(income_gross - income_tax, 2),
            "rebalanced": rb_label, "rebalance_tax": round(rebalance_tax, 2), "tax_credit": round(credit, 2),
            "income_net_so_far": round(totals["income_net"], 2),
        })

    d_end, px_end = days[-1]
    last = res.daily[-1]
    flows.append((d_end, last["total"]))
    years = (d_end - d0).days / 365.0
    end_wealth = last["total"] + totals["income_net"]
    res.summary = {
        "start": d0.isoformat(), "end": d_end.isoformat(), "years": round(years, 2),
        "invested": amount, "quadrant_ratio": quadrant_ratio, "arbitrage_ratio": arbitrage_ratio,
        "monthly_income": monthly_income, "monthly_income_rupees": round(pay, 2),
        "final_value": last["total"],
        "payouts": totals["payouts"], "income_gross": round(totals["income_gross"], 2),
        "income_tax": round(totals["income_tax"], 2), "income_net": round(totals["income_net"], 2),
        "rebalances": len(res.rebalances), "rebalance_tax": round(totals["rebalance_tax"], 2),
        "tax_credit": round(totals["tax_credit"], 2),
        "final_plus_income": round(end_wealth, 2),
        "cagr_pct": round(((end_wealth / amount) ** (1 / years) - 1) * 100, 3) if years > 0 else None,
        "xirr_pct": round(_xirr(flows), 3) if _xirr(flows) is not None else None,
        "max_drawdown_pct": round(dd * 100, 2),
        "arbitrage_ran_out": arb_empty,
        "final_arbitrage_share_pct": round(last["w_arbitrage_of_total"] * 100, 2),
    }
    return res


# ─────────────────────────────── CLI ───────────────────────────────
def _fmt(v: float) -> str:
    return f"₹{v:,.0f}"


def _print_summary(name: str, s: dict) -> None:
    print(f"\n{name}  ({s['start']} → {s['end']}, {s['years']} yrs)")
    print(f"  mix              quadrant {s['quadrant_ratio']:.0%} · arbitrage {s['arbitrage_ratio']:.0%} · "
          f"income {s['monthly_income']:.2%}/month ({_fmt(s['monthly_income_rupees'])})")
    print(f"  final value      {_fmt(s['final_value'])}  (no tax taken off the final value)")
    print(f"  income           {s['payouts']} payouts · gross {_fmt(s['income_gross'])} · tax {_fmt(s['income_tax'])} · net {_fmt(s['income_net'])}")
    print(f"  rebalances       {s['rebalances']} · tax {_fmt(s['rebalance_tax'])}")
    print(f"  return           XIRR {s['xirr_pct']}% · CAGR (final value + income) {s['cagr_pct']}% · max drawdown {s['max_drawdown_pct']}%")
    if s["arbitrage_ran_out"]:
        print(f"  arbitrage ran out {s['arbitrage_ran_out']} (income since then from the quadrant)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Simulate a quadrant + arbitrage portfolio on the daily CSV.")
    ap.add_argument("--quadrant", type=float, help="share in the quadrant (gold/large/mid/small, 25%% each)")
    ap.add_argument("--arbitrage", type=float, help="share in arbitrage")
    ap.add_argument("--income", type=float, default=0.003, help="monthly income as a fraction of the amount (default 0.003)")
    ap.add_argument("--amount", type=float, default=1e7)
    ap.add_argument("--slab", type=float, default=30)
    ap.add_argument("--start-date", "--start", dest="start_date", help="YYYY-MM-DD: when the money goes in (default: the CSV's first day)")
    ap.add_argument("--end")
    ap.add_argument("--rebalance-day", default="jan1", choices=["jan1", "first_trading_day"])
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    ap.add_argument("--preset", choices=sorted(PRESETS))
    ap.add_argument("--all-presets", action="store_true")
    ap.add_argument("--out", help="write the daily rows to this CSV")
    a = ap.parse_args()
    common = dict(start_date=a.start_date, amount=a.amount, slab=a.slab, csv_path=a.csv, end=a.end, rebalance_day=a.rebalance_day)

    if a.all_presets:
        rows = []
        for name, p in PRESETS.items():
            s = simulate(**p, **common).summary
            rows.append((name, s))
        s0 = rows[0][1]
        print(f"₹{a.amount:,.0f} invested {s0['start']} → {s0['end']} ({s0['years']} yrs)\n")
        print(f"{'fund':22s} {'mix':>9s} {'income':>8s} {'final value':>15s} {'income net':>14s} {'XIRR':>7s} {'max DD':>7s}  arbitrage ran out")
        for name, s in rows:
            print(f"{name:22s} {s['quadrant_ratio']:>4.0%}/{s['arbitrage_ratio']:<4.0%} {s['monthly_income']:>7.2%} "
                  f"{_fmt(s['final_value']):>15s} {_fmt(s['income_net']):>14s} "
                  f"{s['xirr_pct']:>6.2f}% {s['max_drawdown_pct']:>6.2f}%  {s['arbitrage_ran_out'] or '—'}")
        return
    if a.preset:
        p = PRESETS[a.preset]
        name = a.preset
    elif a.quadrant is not None and a.arbitrage is not None:
        p = dict(quadrant_ratio=a.quadrant, arbitrage_ratio=a.arbitrage, monthly_income=a.income)
        name = "custom"
    else:
        ap.error("give --quadrant and --arbitrage, or --preset, or --all-presets")
    r = simulate(**p, **common)
    _print_summary(name, r.summary)
    if a.out:
        r.to_csv(a.out)
        print(f"\n  daily rows → {a.out}")


if __name__ == "__main__":
    main()
