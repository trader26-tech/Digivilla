"""What the checks report: each month written out, the per-fund story, the
rebalance rows."""

from __future__ import annotations

from app.calc_check.settings import _cfg
from app.calc_check.tax import _fy_label


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
