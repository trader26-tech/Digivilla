"""Every series in ONE daily CSV — indices, our suggested funds, Nifty 500, and
the villa / quadrant portfolios built from each.

    python research/build_all_series.py [--out digivilla_all_series_daily.csv]

Days = the trading days of 22_quadrant_jan_rebalance_and_arbitrage_daily.csv
(the base file; its five index series are used as they are).

  a) idx_*         the five index series the calculators use (raw levels):
                   Nifty 50 Arbitrage, Nifty 50 TRI, Midcap 150 TRI, Smallcap 250 TRI, Gold BeES
  b) mf_*          our suggested funds, Regular plan, Growth (raw NAV, AMFI via mfapi):
                   the admin's villa bucket (Kotak Arbitrage, Edelweiss Mid Cap, Nippon Small Cap,
                   Bandhan Small Cap, ICICI Gold ETF FoF) + SBI Large Cap (the bucket has no large cap)
  c) nifty500_tri  Nifty 500 TRI (niftyindices.com)
  d) idx_<villa>   Conservative 30/70 · Balanced 64/36 · Aggressive 80/20 (quadrant/arbitrage)
                   built from the indices
  e) mf_<villa>    the same three built from our suggested funds
  f) idx_quadrant_pretax       gold/large/mid/small 25% each, back to 25% every 1 Jan, no tax
     idx_quadrant_with_rules   the same with the rules (for a like-for-like with g)
  g) mf_quadrant_with_rules    the quadrant with the rules, built from our suggested funds

Portfolios (d, e, f, g) are levels starting at 100 = ₹1 Cr invested on their first
day, run by research/portfolio_sim.simulate with its rules: quadrant back to 25%
each on 1 January (tax on what that sells paid from the proceeds, ₹1.25 L yearly
exemption, FIFO lots, 4% cess); arbitrage never rebalanced; no income taken (so a
level is what the money is worth, like a NAV); no tax taken off the value.
Gold: Gold BeES (listed ETF) is long-term after 12 months; the ICICI Gold ETF FoF
after 24 months (today's rule for a fund of funds).
A suggested-fund portfolio starts on the first day every fund in it has a NAV.
"""

from __future__ import annotations

import argparse
import csv
import http.cookiejar
import json
import sys
import tempfile
import urllib.request
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import portfolio_sim as ps  # noqa: E402

BASE_CSV = ps.DEFAULT_CSV
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}

# a) the index series, as named in the base CSV
INDEX = {
    "arbitrage": ("idx_arbitrage_nifty50_arbitrage", "nifty50_arbitrage_index"),
    "large": ("idx_large_nifty50_tri", "nifty50_tri"),
    "mid": ("idx_mid_nifty_midcap150_tri", "nifty_midcap150_tri"),
    "small": ("idx_small_nifty_smallcap250_tri", "nifty_smallcap250_tri"),
    "gold": ("idx_gold_goldbees", "goldbees_price"),
}
# b) our suggested funds (AMFI scheme codes, Regular plan - Growth)
FUNDS = [
    ("mf_large_sbi_large_cap", 103504),
    ("mf_mid_edelweiss_mid_cap", 140225),
    ("mf_small_nippon_india_small_cap", 113177),
    ("mf_small_bandhan_small_cap", 147944),
    ("mf_arbitrage_kotak_arbitrage", 105968),
    ("mf_gold_icici_gold_etf_fof", 115833),
]
# which suggested fund stands in for each part of a suggested-fund portfolio
SUGGESTED = {
    "large": "mf_large_sbi_large_cap",
    "mid": "mf_mid_edelweiss_mid_cap",
    "small": "mf_small_nippon_india_small_cap",   # the bucket's longest-running small cap (Bandhan starts 2020)
    "arbitrage": "mf_arbitrage_kotak_arbitrage",
    "gold": "mf_gold_icici_gold_etf_fof",
}
FOF_GOLD_LT_MONTHS = 24


# ─────────────────────────────── sources ───────────────────────────────
def mf_nav(code: int) -> dict[str, float]:
    req = urllib.request.Request(f"https://api.mfapi.in/mf/{code}", headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    out = {}
    for p in d.get("data") or []:
        try:
            nav = float(p["nav"])
        except (TypeError, ValueError):
            continue
        if nav > 0:
            dd, mm, yy = p["date"].split("-")
            out[f"{yy}-{mm}-{dd}"] = nav
    return out


def nifty_tri(name: str, first: date, last: date) -> dict[str, float]:
    """{day: TRI close} from niftyindices.com, one year per call (the site's limit)."""
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = list(UA.items())
    op.open("https://www.niftyindices.com/reports/historical-data", timeout=60).read()
    out = {}
    for y in range(first.year, last.year + 1):
        a, b = max(first, date(y, 1, 1)), min(last, date(y, 12, 31))
        cinfo = "{'name':'%s','startDate':'%s','endDate':'%s','indexName':'%s'}" % (
            name, a.strftime("%d-%b-%Y"), b.strftime("%d-%b-%Y"), name)
        req = urllib.request.Request(
            "https://www.niftyindices.com/BackPage/getTotalReturnIndexString",
            data=json.dumps({"cinfo": cinfo}).encode(),
            headers={"Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest",
                     "Origin": "https://www.niftyindices.com", "Referer": "https://www.niftyindices.com/reports/historical-data"})
        rows = json.loads(op.open(req, timeout=60).read() or b"[]")
        if isinstance(rows, dict):
            rows = json.loads(rows.get("d") or "[]")
        for row in rows or []:
            try:
                d = datetime.strptime((row.get("Date") or "").strip(), "%d %b %Y").date().isoformat()
                out[d] = float(str(row.get("TotalReturnsIndex")).replace(",", ""))
            except (TypeError, ValueError):
                continue
    return out


def on_days(days: list[str], series: dict[str, float]) -> list[float | None]:
    """The series on each base day: that day's value, else the last one before it;
    None before the series starts."""
    keys = sorted(series)
    out, j, last = [], 0, None
    for d in days:
        while j < len(keys) and keys[j] <= d:
            last = series[keys[j]]
            j += 1
        out.append(last)
    return out


# ─────────────────────────────── portfolios ───────────────────────────────
def level(rows: list[dict], cols: dict[str, str], q: float, arb: float, taxes: bool,
          gold_lt_months: int | None = None) -> dict[str, float]:
    """{day: 100 × value / ₹1 Cr} for one mix, on the days every part has a value."""
    usable = [r for r in rows if all(r[c] is not None for c in cols.values())]
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date"] + [ps.COLUMNS[p] for p in ps.PARTS])
        for r in usable:
            w.writerow([r["date"]] + [r[cols[p]] for p in ps.PARTS])
        path = fh.name
    keep = ps.TAX["gold_lt_months"]
    if gold_lt_months is not None:
        ps.TAX["gold_lt_months"] = gold_lt_months
    try:
        res = ps.simulate(q, arb, 0.0, amount=1e7, csv_path=path, taxes=taxes)
    finally:
        ps.TAX["gold_lt_months"] = keep
        Path(path).unlink(missing_ok=True)
    return {d["date"]: d["total"] / 1e5 for d in res.daily}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(HERE.parent / "digivilla_all_series_daily.csv"))
    a = ap.parse_args()

    with open(BASE_CSV, newline="") as fh:
        base = list(csv.DictReader(fh))
    days = [r["date"] for r in base]
    rows = [{"date": d} for d in days]
    for (col, src) in INDEX.values():
        for r, b in zip(rows, base):
            r[col] = float(b[src])

    for col, code in FUNDS:
        print(f"  NAV {code} → {col}", file=sys.stderr)
        for r, v in zip(rows, on_days(days, mf_nav(code))):
            r[col] = v
    print("  Nifty 500 TRI", file=sys.stderr)
    n500 = nifty_tri("NIFTY 500", date.fromisoformat(days[0]) .replace(day=1), date.fromisoformat(days[-1]))
    for r, v in zip(rows, on_days(days, n500)):
        r["nifty500_tri"] = v

    idx_cols = {p: INDEX[p][0] for p in ps.PARTS}
    villas = [(v["key"], round(1 - float(v["weights"].get("arbitrage", 0)), 10), float(v["weights"].get("arbitrage", 0)))
              for v in ps.SETTINGS["villas"]]
    port: dict[str, dict[str, float]] = {}
    for key, q, arb in villas:
        tag = f"{key}_{round(q * 100)}_{round(arb * 100)}"
        print(f"  {tag}", file=sys.stderr)
        port[f"idx_{tag}"] = level(rows, idx_cols, q, arb, taxes=True)
        port[f"mf_{tag}"] = level(rows, SUGGESTED, q, arb, taxes=True, gold_lt_months=FOF_GOLD_LT_MONTHS)
    port["idx_quadrant_pretax"] = level(rows, idx_cols, 1.0, 0.0, taxes=False)
    port["idx_quadrant_with_rules"] = level(rows, idx_cols, 1.0, 0.0, taxes=True)
    port["mf_quadrant_with_rules"] = level(rows, SUGGESTED, 1.0, 0.0, taxes=True, gold_lt_months=FOF_GOLD_LT_MONTHS)
    # column order: d) idx villas, e) mf villas, f) quadrant, g) quadrant from funds
    order = [k for k in port if k.startswith("idx_") and "quadrant" not in k] + \
            [k for k in port if k.startswith("mf_") and "quadrant" not in k] + \
            ["idx_quadrant_pretax", "idx_quadrant_with_rules", "mf_quadrant_with_rules"]
    for r in rows:
        for k in order:
            v = port[k].get(r["date"])
            r[k] = None if v is None else v

    cols = ["date"] + [c for c, _ in INDEX.values()] + [c for c, _ in FUNDS] + ["nifty500_tri"] + order
    with open(a.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([r["date"]] + ["" if r[c] is None else (round(r[c], 4) if c in port else r[c]) for c in cols[1:]])
    print(f"wrote {a.out}: {len(rows)} days × {len(cols) - 1} series", file=sys.stderr)


if __name__ == "__main__":
    main()
