"""Financial years, today's tax rules (from the settings) and IRR."""

from __future__ import annotations

from typing import Optional

from app.calc_check.settings import _cfg


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

def _fy_label(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    s = y if mo >= 4 else y - 1
    return f"FY {s}-{str(s + 1)[2:]}"
