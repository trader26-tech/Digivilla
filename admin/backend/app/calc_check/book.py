"""The holdings, lot by lot (FIFO): payouts from the pay-first parts, the yearly
rebalance with its tax paid from the proceeds — every rule from the settings.
The Python twin of client/frontend/src/app/calc/engine/book.ts."""

from __future__ import annotations

from app.calc_check.settings import _cfg
from app.calc_check.tax import _Tax


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
