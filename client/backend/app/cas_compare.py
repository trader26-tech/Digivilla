"""CAS comparison — "your mutual funds today vs the same money in the DigiVilla basket".

Input is a parsed CAS (app.cas_parser). A depository CAS has no purchase history,
so this is a HOLDINGS BACKTEST: take the investor's current MF mix (by value),
and replay the SAME rupee amount through (a) that mix and (b) the DigiVilla basket
over the last 1 / 3 / 5 / 10 years, buy-and-hold, on real month-end NAVs.

  * ISIN → AMFI scheme code comes from AMFI's NAVAll.txt (which lists every ISIN).
  * Funds younger than a window are extended back with a same-kind long-history
    fund (e.g. a 2024 liquid ETF uses ICICI Prudential Liquid Fund before 2024);
    each stand-in is reported so the UI can say so. A fund with NO usable history
    for a window (e.g. silver before 2022) is left out of that window and its
    share is reported; a window missing >10% of the money is not shown at all.
  * Daily-payout ETFs (Liquid BeES) keep a flat ₹1000 NAV — their NAV series has
    no growth in it, so they are modelled entirely on their stand-in.
  * The basket is the investor's OWN villa mix, else the standard mix — the same
    one the calculators use (app.calculators), with the same sleeve stand-ins.

Metrics per window: final value, total return, CAGR, annualised volatility (monthly
returns × √12), max drawdown, worst month, share of down months. The verdict is
written from those numbers — whichever side they favour.
"""

from __future__ import annotations

import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

from app.calculators import SLEEVE_PROXIES, _basket_funds, _splice

WINDOWS = [(12, "1Y"), (36, "3Y"), (60, "5Y"), (120, "10Y")]
_MAX_MISSING = 0.10          # a window may leave out at most 10% of the money

# ── AMFI ISIN index ──────────────────────────────────────────────────────────

_AMFI = "https://www.amfiindia.com/spages/NAVAll.txt"
_AMFI_TTL = 6 * 3600
_isin_idx: tuple[float, dict[str, dict]] = (0.0, {})


def _amfi_isin_index() -> dict[str, dict]:
    """{isin: {code, name, category}} for every scheme AMFI publishes. Cached per
    worker; on a fetch failure the last good index is kept."""
    global _isin_idx
    now = time.time()
    if _isin_idx[1] and now - _isin_idx[0] < _AMFI_TTL:
        return _isin_idx[1]
    try:
        r = httpx.get(_AMFI, timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        out: dict[str, dict] = {}
        category = ""
        for line in r.text.splitlines():
            line = line.strip()
            if not line:
                continue
            if ";" not in line:
                if "Schemes(" in line or "Scheme(" in line:
                    category = line[line.find("(") + 1:].rstrip(")")
                continue
            parts = [p.strip() for p in line.split(";")]
            if not parts[0].isdigit() or len(parts) < 6:
                continue
            name = re.sub(r"\s*-\s*$", "", parts[3])
            for isin in (parts[1], parts[2]):
                if re.fullmatch(r"IN[A-Z0-9]{10}", isin or ""):
                    out[isin] = {"code": int(parts[0]), "name": name, "category": category}
        if out:
            _isin_idx = (now, out)
    except Exception:
        pass
    return _isin_idx[1]


# ── what kind of fund is it (drives the stand-in chain + the mix chart) ──────

# Long-history stand-ins per kind (AMFI codes; first NAV verified on mfapi 2026-09-27).
KIND_PROXIES: dict[str, list[tuple[int, str]]] = {
    "liquid":    [(103340, "ICICI Prudential Liquid Fund")],               # from Apr 2006
    "debt":      [(103340, "ICICI Prudential Liquid Fund")],
    "arbitrage": SLEEVE_PROXIES["arbitrage"],
    "large":     [(140084, "Nippon India ETF Nifty 50 BeES")] + SLEEVE_PROXIES["large"],
    "bank":      [(140087, "Nippon India ETF Nifty Bank BeES")],          # from 2016
    "mid":       SLEEVE_PROXIES["mid"],
    "small":     SLEEVE_PROXIES["small"],
    "gold":      [(140088, "Nippon India ETF Gold BeES")] + SLEEVE_PROXIES["gold"],
    "hybrid":    SLEEVE_PROXIES["other"],
    "equity":    [(140084, "Nippon India ETF Nifty 50 BeES")] + SLEEVE_PROXIES["large"],
    "silver":    [],
    "global":    [],
}

KIND_LABEL = {
    "liquid": "Liquid / cash", "debt": "Debt", "arbitrage": "Arbitrage", "large": "Large cap / Nifty",
    "bank": "Banking", "mid": "Mid cap", "small": "Small cap", "gold": "Gold", "silver": "Silver",
    "hybrid": "Hybrid", "equity": "Equity (other)", "global": "International",
}
SLEEVE_TO_KIND = {"arbitrage": "arbitrage", "large": "large", "mid": "mid", "small": "small",
                  "gold": "gold", "other": "hybrid"}


def _kind(name: str, category: str) -> str:
    n, c = name.lower(), category.lower()
    if "silver" in n or "silver" in c:
        return "silver"
    if "gold" in n or "gold" in c:
        return "gold"
    if "arbitrage" in n or "arbitrage" in c:
        return "arbitrage"
    if any(k in n for k in ("liquid", "overnight", "1d rate", "money market")) or \
            any(k in c for k in ("liquid", "overnight", "money market")):
        return "liquid"
    if "overseas" in c or any(k in n for k in ("nasdaq", "s&p 500", "hang seng", "global", "us equity")):
        return "global"
    if "debt" in c or "gilt" in c or any(k in n for k in ("gilt", "bond", "g-sec", "sdl", "bharat bond")):
        return "debt"
    if "bank" in n and "psu" not in n:
        return "bank"
    if "small" in n or "small cap" in c:
        return "small"
    if "mid" in n or "mid cap" in c:
        return "mid"
    if "hybrid" in c or "balanced" in c or "asset allocation" in c or "equity savings" in c:
        return "hybrid"
    if any(k in n for k in ("nifty 50", "sensex", "nifty next", "large", "bluechip", "top 100")) or "large cap" in c:
        return "large"
    return "equity"


_SPLIT_LO, _SPLIT_HI = 0.6, 1.6    # no fund moves ±40% in a day — that's a unit split
_GAP_DAYS = 45


def _monthly(code: int) -> dict[str, float]:
    """Month-end NAV keyed 'YYYY-MM', CLEANED for use as a return series:
      * a stray early point followed by a long gap is dropped (history restarts
        after the last gap longer than 45 days);
      * unit splits / face-value changes (Nifty BeES 1:10 and Gold BeES 1:100 in
        Dec 2019, ICICI Liquid ×10 in 2009) show up as a one-day NAV jump — all
        earlier NAVs are rescaled by that jump so the series stays continuous."""
    from datetime import date as _d
    from app.client_portfolio import _fetch_full_nav_memo
    pts = []
    for p in _fetch_full_nav_memo(int(code)) or []:
        d = p.date if isinstance(p.date, str) else p.date.isoformat()
        if float(p.nav) > 0:
            pts.append((d[:10], float(p.nav)))
    pts.sort()
    start = 0
    for i in range(1, len(pts)):
        if (_d.fromisoformat(pts[i][0]) - _d.fromisoformat(pts[i - 1][0])).days > _GAP_DAYS:
            start = i
    pts = pts[start:]
    navs = [v for _, v in pts]
    for i in range(len(navs) - 1, 0, -1):
        r = navs[i] / navs[i - 1]
        if not (_SPLIT_LO < r < _SPLIT_HI):
            for j in range(i):
                navs[j] *= r
    out: dict[str, float] = {}
    for (d, _), v in zip(pts, navs):
        out[d[:7]] = v                      # last write wins = month end
    return out


def _is_flat(m: dict[str, float]) -> bool:
    """A daily-payout fund whose NAV never moves (e.g. Liquid BeES at ₹1000)."""
    keys = sorted(m)[-24:]
    if len(keys) < 6:
        return False
    vals = [m[k] for k in keys]
    return max(vals) / min(vals) < 1.002 if min(vals) > 0 else False


# ── month maths ──────────────────────────────────────────────────────────────

def _ym_add(ym: str, months: int) -> str:
    y, m = map(int, ym.split("-"))
    t = y * 12 + (m - 1) + months
    return f"{t // 12}-{t % 12 + 1:02d}"


def _months(a: str, b: str) -> list[str]:
    out, k = [], a
    while k <= b:
        out.append(k)
        k = _ym_add(k, 1)
    return out


def _metrics(path: list[float], months: int) -> dict:
    start, end = path[0], path[-1]
    rets = [path[i] / path[i - 1] - 1 for i in range(1, len(path)) if path[i - 1] > 0]
    vol = 0.0
    if len(rets) > 1:
        mu = sum(rets) / len(rets)
        vol = math.sqrt(sum((r - mu) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(12)
    peak, mdd = path[0], 0.0
    for v in path:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    total = end / start - 1 if start else 0.0
    cagr = (end / start) ** (12 / months) - 1 if start and months >= 12 else total
    return {
        "final": round(end),
        "gain": round(end - start),
        "total_return_pct": round(total * 100, 2),
        "cagr_pct": round(cagr * 100, 2),
        "volatility_pct": round(vol * 100, 2),
        "max_drawdown_pct": round(mdd * 100, 2),
        "worst_month_pct": round(min(rets) * 100, 2) if rets else 0.0,
        "down_months_pct": round(100 * sum(1 for r in rets if r < 0) / len(rets)) if rets else 0,
        "return_per_risk": round(cagr / vol, 2) if vol > 0.0005 else None,
    }


# ── full portfolio (everything the statement holds, not just the MFs) ─────────

# Broad asset classes shown in the "Your full portfolio" view, in display order.
# Each demat/folio holding maps to one by its `kind`; depository-summary-only
# classes (FDs, insurance, NPS…) are folded in from the statement's own by_class.
_CLASS_ORDER = ["stocks", "mf", "bonds", "gold", "fd", "insurance", "nps", "aif", "other"]
_CLASS_LABEL = {
    "stocks": "Stocks", "mf": "Mutual funds", "bonds": "Bonds & debt", "gold": "Gold & silver",
    "fd": "Fixed deposits", "insurance": "Insurance", "nps": "NPS", "aif": "AIF / PMS",
    "other": "Other assets",
}
# statement by_class label (lower) → our class key; each substring test in order.
_SUMMARY_TO_CLASS = [
    ("mutual fund", None),          # already itemized as holdings — skip the summary row
    ("equit", "stocks"), ("share", "stocks"),
    ("bond", "bonds"), ("debt", "bonds"), ("government", "bonds"), ("g-sec", "bonds"),
    ("gold", "gold"), ("silver", "gold"),
    ("fixed deposit", "fd"), ("deposit", "fd"),
    ("insurance", "insurance"), ("ulip", "insurance"),
    ("nps", "nps"), ("pension", "nps"),
    ("aif", "aif"), ("pms", "aif"), ("portfolio management", "aif"),
]


def _holding_class(h: dict) -> str:
    """Broad asset class for one itemized holding (mf | bond | security)."""
    kind = h.get("kind")
    if kind == "mf":
        return "mf"
    if kind == "bond":
        return "bonds"
    name = (h.get("name") or "").lower()
    if any(k in name for k in ("gold", "silver", "bees")) and "etf" in name:
        return "gold"
    # a demat "security" that is actually a bond/G-Sec by name
    if any(k in name for k in ("bond", "g-sec", "sdl", "gilt", "debenture", "ncd", "bharat bond")):
        return "bonds"
    return "stocks"


def _summary_class(label: str) -> Optional[str]:
    low = label.lower()
    for needle, cls in _SUMMARY_TO_CLASS:
        if needle in low:
            return cls
    return "other"


def _full_portfolio(parsed: dict) -> dict:
    """The WHOLE statement grouped by asset class — every itemized holding
    (stocks, bonds, MFs, gold) plus the depository-summary-only classes (FDs,
    insurance, NPS…) folded in from the statement's printed by_class totals.
    Every figure here is one the parser already reconciled to the statement."""
    groups: dict[str, dict] = {}

    def bucket(cls: str) -> dict:
        return groups.setdefault(cls, {"class": cls, "label": _CLASS_LABEL.get(cls, cls),
                                       "value": 0.0, "count": 0, "items": [], "itemized": False})

    itemized_value: dict[str, float] = {}
    for h in parsed.get("holdings", []):
        v = float(h.get("value") or 0)
        if v <= 0:
            continue
        cls = _holding_class(h)
        g = bucket(cls)
        g["value"] += v
        g["count"] += 1
        g["itemized"] = True
        itemized_value[cls] = itemized_value.get(cls, 0.0) + v
        # keep the biggest items per class (name + value); units/price for detail
        g["items"].append({"name": _tidy_name(h.get("name") or ""), "value": round(v, 2),
                           "units": round(float(h.get("units") or 0), 4),
                           "account": h.get("account", "")})

    # Summary-only classes (FD/insurance/NPS…) may ONLY fill a genuine gap between
    # the itemized holdings and the statement's own verified grand total. The
    # statement's asset-class table re-states money that is already itemized (and
    # ends with a 'Total' row), so adding it on top double-counts. Normally the
    # itemized holdings tie to the grand total exactly, so nothing is added.
    itemized_sum = sum(itemized_value.values())
    printed_grand = parsed.get("totals", {}).get("grand")
    gap = (float(printed_grand) - itemized_sum) if printed_grand is not None else 0.0
    if gap > 1.0:
        for label, val in (parsed.get("totals", {}).get("by_class") or {}).items():
            v = float(val or 0)
            low = label.lower()
            if v <= 0 or "total" in low:            # never the table's own total row
                continue
            cls = _summary_class(label)
            if cls is None or cls in itemized_value:   # already itemized — not a gap
                continue
            if v > gap + 0.011:                      # can't exceed the unexplained gap
                continue
            g = bucket(cls)
            g["value"] += v
            g["summary_label"] = label
            gap -= v

    # sort items within each class, biggest first; order the classes canonically
    for g in groups.values():
        g["items"].sort(key=lambda it: -it["value"])
    grand = sum(g["value"] for g in groups.values())
    out = []
    for cls in _CLASS_ORDER:
        if cls in groups and groups[cls]["value"] > 0:
            g = groups[cls]
            out.append({**g, "value": round(g["value"], 2),
                        "pct": round(g["value"] / grand * 100, 1) if grand else 0.0})
    return {"grand_total": round(grand, 2), "classes": out}


# ── main ─────────────────────────────────────────────────────────────────────

def compare(owner: Optional[str], parsed: dict) -> dict:
    mf = [h for h in parsed.get("holdings", []) if h.get("kind") == "mf" and h.get("value", 0) > 0]
    if not mf:
        # Nothing to COMPARE, but we can still show the full portfolio we read.
        return {"ok": True, "compare": False,
                "detail": "No mutual funds to compare — here's everything else we read.",
                "as_of": parsed.get("statement_date"),
                "statement": {
                    "source": parsed.get("source"), "date": parsed.get("statement_date"),
                    "investor": parsed.get("investor", {}).get("name", ""),
                    "grand_total": parsed.get("totals", {}).get("grand"),
                    "checks_passed": sum(1 for c in parsed.get("checks", []) if c.get("ok")),
                    "checks_total": len(parsed.get("checks", [])),
                    "checks": [{"label": c["label"], "ok": c["ok"]} for c in parsed.get("checks", [])],
                },
                "portfolio": _full_portfolio(parsed)}

    # 1) aggregate the same fund across accounts/folios, map ISIN → scheme code
    idx = _amfi_isin_index()
    funds: dict[str, dict] = {}
    for h in mf:
        key = h.get("isin") or h.get("name")
        f = funds.setdefault(key, {"isin": h.get("isin"), "raw_name": h.get("name"), "value": 0.0,
                                   "units": 0.0, "invested": None, "code": h.get("scheme_code")})
        f["value"] += float(h["value"])
        f["units"] += float(h.get("units") or 0)
        if h.get("invested") is not None:
            f["invested"] = (f["invested"] or 0.0) + float(h["invested"])
    for f in funds.values():
        meta = idx.get(f["isin"] or "") or {}
        f["code"] = f["code"] or meta.get("code")
        f["name"] = meta.get("name") or _tidy_name(f["raw_name"])
        f["kind"] = _kind(f["name"], meta.get("category", ""))

    total = sum(f["value"] for f in funds.values())
    for f in funds.values():
        f["weight"] = f["value"] / total

    # 2) basket (the user's own villa mix, else the standard mix)
    basket, is_own = _basket_funds(owner)
    bw = sum(float(b["allocation"]) for b in basket) or 1.0

    # 3) fetch every series we need, concurrently (memoised per worker)
    codes: set[int] = set()
    for f in funds.values():
        if f["code"]:
            codes.add(int(f["code"]))
        codes.update(c for c, _ in KIND_PROXIES.get(f["kind"], []))
    for b in basket:
        codes.add(int(b["scheme_code"]))
        codes.update(c for c, _ in SLEEVE_PROXIES.get(b.get("sleeve") or "other", SLEEVE_PROXIES["other"]))
    with ThreadPoolExecutor(max_workers=min(12, len(codes) or 1)) as ex:
        monthly = dict(zip(codes, ex.map(_monthly, codes)))

    def spliced(code: Optional[int], chain: list[tuple[int, str]]) -> tuple[dict, list, bool]:
        own = monthly.get(int(code), {}) if code else {}
        flat = bool(own) and _is_flat(own)
        if flat:
            own = {}
        chain_s = [(n, monthly.get(c, {})) for c, n in chain if c != code]
        series, used = _splice(own, chain_s)
        if not own:
            # modelled wholly on the stand-in(s): say so (until = never its own data)
            first = next((n for n, m in chain_s if m), None)
            if first:
                used = [{"name": first, "until": "9999-12"}] + used
        return series, used, flat

    yours = []
    for f in sorted(funds.values(), key=lambda x: -x["value"]):
        s, used, flat = spliced(f["code"], KIND_PROXIES.get(f["kind"], []))
        own = monthly.get(int(f["code"]), {}) if f["code"] else {}
        yours.append({**f, "idx": s, "proxy": used, "flat_nav": flat,
                      "since": min(own) if own and not flat else None})
    bask = []
    for b in basket:
        sleeve = b.get("sleeve") or "other"
        s, used, _ = spliced(int(b["scheme_code"]), SLEEVE_PROXIES.get(sleeve, SLEEVE_PROXIES["other"]))
        bask.append({"name": b.get("name") or "Fund", "sleeve": sleeve, "kind": SLEEVE_TO_KIND.get(sleeve, "hybrid"),
                     "weight": float(b["allocation"]) / bw, "idx": s, "proxy": used,
                     "since": min(monthly.get(int(b["scheme_code"]), {}) or {"": 0}) or None})
    if any(not b["idx"] for b in bask):
        return {"ok": False, "detail": "Couldn't load the basket's fund history. Try again in a minute."}

    # 4) common end month = the freshest month EVERY series with data has reached
    ends = [max(x["idx"]) for x in yours + bask if x["idx"]]
    end = min(ends)

    windows = []
    for n, label in WINDOWS:
        start = _ym_add(end, -n)
        months = _months(start, end)
        inc = [f for f in yours if f["idx"] and all(k in f["idx"] for k in (start, end))]
        missing = [f for f in yours if f not in inc]
        miss_w = sum(f["weight"] for f in missing)
        if miss_w > _MAX_MISSING or any(not all(k in b["idx"] for k in months) for b in bask):
            continue
        iw = sum(f["weight"] for f in inc)
        p_y, p_b = [], []
        for k in months:
            vy = 0.0
            for f in inc:
                # carry the last known month forward over any gap in a series
                v = f["idx"].get(k) or _last_before(f["idx"], k)
                vy += (f["weight"] / iw) * v / f["idx"][start]
            p_y.append(total * vy)
            p_b.append(total * sum(b["weight"] * b["idx"][k] / b["idx"][start] for b in bask))
        my, mb = _metrics(p_y, n), _metrics(p_b, n)
        windows.append({
            "key": label, "months": n, "start": start, "end": end,
            "yours": my, "basket": mb,
            "diff": round(mb["final"] - my["final"]),
            "winner": "basket" if mb["final"] > my["final"] else "yours",
            "left_out": [{"name": f["name"], "weight_pct": round(f["weight"] * 100, 2)} for f in missing],
            "series": {"dates": months, "yours": [round(v) for v in p_y], "basket": [round(v) for v in p_b]},
            "proxied": sorted({p["name"] for f in inc for p in f["proxy"] if p["until"] > start} |
                              {p["name"] for b in bask for p in b["proxy"] if p["until"] > start}),
        })
    if not windows:
        return {"ok": False, "detail": "Your funds don't have enough price history to compare yet."}

    return {
        "ok": True,
        "compare": True,
        "as_of": end,
        "amount": round(total),
        "basket_is_own": is_own,
        "statement": {
            "source": parsed.get("source"), "date": parsed.get("statement_date"),
            "investor": parsed.get("investor", {}).get("name", ""),
            "grand_total": parsed.get("totals", {}).get("grand"),
            "other_assets": {k: v for k, v in (parsed.get("totals", {}).get("by_class") or {}).items()
                             if "Mutual Fund" not in k and v},
            "checks_passed": sum(1 for c in parsed.get("checks", []) if c.get("ok")),
            "checks_total": len(parsed.get("checks", [])),
            "checks": [{"label": c["label"], "ok": c["ok"]} for c in parsed.get("checks", [])],
        },
        # the WHOLE statement, grouped by asset class (stocks, MFs, bonds, gold,
        # + FD/insurance/NPS summary totals) — everything, not just the compared MFs.
        "portfolio": _full_portfolio(parsed),
        "your_funds": [_fund_row(f, end) for f in yours],
        "basket_funds": [_fund_row(b, end) for b in bask],
        "mix": {"yours": _mix(yours), "basket": _mix(bask)},
        "windows": windows,
        "verdict": _verdict(windows),
    }


def _last_before(s: dict, k: str) -> float:
    prior = [m for m in s if m <= k]
    return s[max(prior)] if prior else 0.0


def _tidy_name(raw: str) -> str:
    """'NIPPON LIFE INDIA AM LTD#NIPPON INDIA MF-NIPPON INDIA ETF…' → the scheme part."""
    s = (raw or "").split("#")[-1]
    s = re.sub(r"^[A-Z .&()]+ MF-", "", s)
    return s.title()


def _fund_row(f: dict, end: str) -> dict:
    s = f["idx"]
    out = {"name": f["name"], "kind": f["kind"], "kind_label": KIND_LABEL.get(f["kind"], f["kind"]),
           "weight_pct": round(f["weight"] * 100, 2), "value": round(f.get("value") or 0),
           "since": f.get("since"), "flat_nav": f.get("flat_nav", False),
           "proxy": [{"name": p["name"], "until": p["until"]} for p in f["proxy"]]}
    if f.get("invested"):
        out["invested"] = round(f["invested"])
    for n, label in ((12, "1Y"), (36, "3Y"), (60, "5Y")):
        st = _ym_add(end, -n)
        if st in s and end in s and s[st] > 0:
            m = s[end] / s[st]
            out[f"cagr_{label}"] = round(((m ** (12 / n)) - 1) * 100, 2)
    return out


def _mix(rows: list[dict]) -> list[dict]:
    agg: dict[str, float] = {}
    for r in rows:
        agg[r["kind"]] = agg.get(r["kind"], 0.0) + r["weight"]
    return [{"kind": k, "label": KIND_LABEL.get(k, k), "pct": round(v * 100, 1)}
            for k, v in sorted(agg.items(), key=lambda kv: -kv[1])]


def _lakh(v: float) -> str:
    a = abs(v)
    if a >= 1e7:
        return f"₹{v / 1e7:.2f} Cr"
    if a >= 1e5:
        return f"₹{v / 1e5:.2f} L"
    return f"₹{v:,.0f}"


def _verdict(windows: list[dict]) -> dict:
    """A categorical call from the numbers: who ended with more money over the
    longest window, whether that held across windows, and at what risk."""
    main = windows[-1]                    # the longest window available
    wins = sum(1 for w in windows if w["winner"] == "basket")
    b, y = main["basket"], main["yours"]
    winner = main["winner"]
    consistent = (wins == len(windows)) if winner == "basket" else (wins == 0)
    yrs = main["months"] // 12
    period = f"{yrs} year{'s' if yrs != 1 else ''}"
    gap = abs(main["diff"])
    if winner == "basket":
        headline = f"The DigiVilla basket would have made you {_lakh(gap)} more over {period}."
    else:
        headline = f"Your current funds did better — {_lakh(gap)} more than the basket over {period}."
    rate = (f"{b['cagr_pct']:.1f}% a year in the basket vs {y['cagr_pct']:.1f}% a year in your funds.")
    w_, l_ = (b, y) if winner == "basket" else (y, b)
    who = "the basket" if winner == "basket" else "your funds"
    bumpier = w_["volatility_pct"] > l_["volatility_pct"]
    deeper = w_["max_drawdown_pct"] < l_["max_drawdown_pct"]
    if bumpier and deeper:
        risk = (f"The price: a bumpier ride. {who.capitalize()} swung {w_['volatility_pct']:.1f}% a year "
                f"(vs {l_['volatility_pct']:.1f}%) and its worst fall was {abs(w_['max_drawdown_pct']):.1f}% "
                f"(vs {abs(l_['max_drawdown_pct']):.1f}%).")
    elif not bumpier and not deeper:
        risk = (f"And with less risk: {who} swung {w_['volatility_pct']:.1f}% a year (vs {l_['volatility_pct']:.1f}%) "
                f"and its worst fall was {abs(w_['max_drawdown_pct']):.1f}% (vs {abs(l_['max_drawdown_pct']):.1f}%).")
    else:
        risk = (f"Risk was mixed: {who} swung {w_['volatility_pct']:.1f}% a year (vs {l_['volatility_pct']:.1f}%), "
                f"worst fall {abs(w_['max_drawdown_pct']):.1f}% (vs {abs(l_['max_drawdown_pct']):.1f}%).")
    return {
        "winner": winner,
        "consistent": consistent,
        "wins": wins,
        "of": len(windows),
        "headline": headline,
        "rate": rate,
        "risk": risk,
        "window": main["key"],
    }


# ── warm-up (called when the upload screen opens) ────────────────────────────

_warm_at = 0.0
_WARM_TTL = 1800


def prewarm(owner: Optional[str]) -> None:
    """Get everything that doesn't depend on the user's file ready while they
    pick it: parse workers, the ISIN index, and the NAV history of the basket and
    every stand-in fund. Runs in a background thread; safe to call repeatedly."""
    global _warm_at
    if time.time() - _warm_at < _WARM_TTL:
        return
    _warm_at = time.time()

    def run():
        from app import cas_parser
        try:
            cas_parser.warm()
        except Exception:
            pass
        _amfi_isin_index()
        codes = {c for chain in KIND_PROXIES.values() for c, _ in chain}
        try:
            basket, _ = _basket_funds(owner)
            codes |= {int(b["scheme_code"]) for b in basket}
        except Exception:
            pass
        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(_monthly, codes))

    import threading
    threading.Thread(target=run, daemon=True).start()
