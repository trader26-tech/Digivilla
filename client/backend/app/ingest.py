"""Ingest Indian mutual fund data, compute metrics, rank, and keep the top ~1000.

Sources (free, official, legitimate — no paywalled scraping):
  * AMFI NAVAll feed  -> the full scheme catalog + latest NAV
  * api.mfapi.in/mf/<code> -> per-scheme NAV history (for returns/risk)

Pipeline:
  1. Parse AMFI -> all schemes with fund house / category / NAV.
  2. Keep only GROWTH plans (dashboards compare total return, not IDCW payouts),
     prefer DIRECT plans, and drop tiny / closed categories.
  3. For a bounded shortlist per category, fetch NAV history and compute
     trailing returns, CAGR, volatility, max drawdown, and a composite score.
  4. Rank within each category and keep the top N per category so the final set
     is ~1000 funds spread across categories (not 900 large-caps).
  5. Upsert into the Supabase `dashboard_funds` table.

Run:  python -m app.ingest         (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
      python -m app.ingest --dry   (compute only, print summary, no DB writes)
"""

from __future__ import annotations

import argparse
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterable, Optional

import httpx

AMFI_NAV_ALL_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
MFAPI_SCHEME_URL = "https://api.mfapi.in/mf/{code}"

TARGET_TOTAL = 1000
_SCHEME_ROW = re.compile(r"^\d+;")

# Category grouping: map AMFI's fine-grained category strings to broad buckets
# the dashboard organizes around, plus how many top funds to keep per bucket.
CATEGORY_BUCKETS: dict[str, int] = {
    "Large Cap": 90,
    "Large & Mid Cap": 70,
    "Mid Cap": 80,
    "Small Cap": 80,
    "Flexi Cap": 80,
    "Multi Cap": 60,
    "ELSS": 70,
    "Focused": 50,
    "Value / Contra": 50,
    "Sectoral / Thematic": 90,
    "Index / ETF": 70,
    "Aggressive Hybrid": 50,
    "Balanced Advantage": 50,
    "Conservative Hybrid": 30,
    "Multi Asset": 30,
    "Corporate Bond": 30,
    "Short / Low Duration": 30,
    "Liquid / Overnight": 30,
    "Gilt": 20,
    "Gold": 20,
}


def _bucket_for(category: Optional[str]) -> Optional[str]:
    """Map an AMFI category string to one of our broad buckets."""
    if not category:
        return None
    c = category.lower()
    if "overnight" in c or "liquid" in c:
        return "Liquid / Overnight"
    if "gilt" in c:
        return "Gilt"
    if "gold" in c:
        return "Gold"
    if "corporate bond" in c:
        return "Corporate Bond"
    if "low duration" in c or "short duration" in c or "ultra short" in c or "money market" in c:
        return "Short / Low Duration"
    if "elss" in c or "tax saver" in c:
        return "ELSS"
    if "index" in c or "etf" in c:
        return "Index / ETF"
    if "large & mid" in c or "large and mid" in c:
        return "Large & Mid Cap"
    if "large cap" in c:
        return "Large Cap"
    if "mid cap" in c:
        return "Mid Cap"
    if "small cap" in c:
        return "Small Cap"
    if "flexi cap" in c:
        return "Flexi Cap"
    if "multi cap" in c:
        return "Multi Cap"
    if "focused" in c:
        return "Focused"
    if "value" in c or "contra" in c:
        return "Value / Contra"
    if "sectoral" in c or "thematic" in c:
        return "Sectoral / Thematic"
    if "balanced advantage" in c or "dynamic asset" in c:
        return "Balanced Advantage"
    if "aggressive hybrid" in c:
        return "Aggressive Hybrid"
    if "conservative hybrid" in c:
        return "Conservative Hybrid"
    if "multi asset" in c:
        return "Multi Asset"
    return None


def _asset_class_for(bucket: str) -> str:
    if bucket in {"Corporate Bond", "Short / Low Duration", "Liquid / Overnight", "Gilt"}:
        return "debt"
    if bucket in {"Aggressive Hybrid", "Balanced Advantage", "Conservative Hybrid", "Multi Asset"}:
        return "hybrid"
    if bucket == "Gold":
        return "gold"
    return "equity"


@dataclass
class RawScheme:
    scheme_code: int
    isin: Optional[str]
    name: str
    nav: Optional[float]
    nav_date: Optional[str]
    fund_house: Optional[str]
    category: Optional[str]
    bucket: Optional[str]


@dataclass
class ScoredFund:
    scheme_code: int
    isin: Optional[str]
    name: str
    fund_house: Optional[str]
    category: str
    bucket: str
    asset_class: str
    plan: str
    nav: float
    nav_date: Optional[str]
    return_1y: Optional[float] = None
    return_3y: Optional[float] = None
    return_5y: Optional[float] = None
    cagr_since_inception: Optional[float] = None
    volatility: Optional[float] = None
    max_drawdown: Optional[float] = None
    inception_date: Optional[str] = None
    history_points: int = 0
    score: float = 0.0
    rating: int = 3
    signals: list[str] = field(default_factory=list)


def _clean(v: str) -> Optional[str]:
    v = v.strip()
    return None if v in {"", "-", "N.A.", "N/A"} else v


def _display_name(name: str) -> str:
    """Trim plan/option boilerplate so cards read cleanly.

    'BANDHAN Small Cap Fund - Regular Plan - Growth' -> 'BANDHAN Small Cap Fund'
    """
    out = name
    for junk in (
        " - Regular Plan - Growth Option",
        " - Regular Plan - Growth",
        " - REGULAR PLAN - GROWTH",
        " - Regular Plan",
        " - Growth Option",
        " - Growth",
        " Regular Plan Growth",
        " - GROWTH OPTION",
        " - GROWTH",
    ):
        if out.upper().endswith(junk.upper()):
            out = out[: len(out) - len(junk)]
    return out.strip(" -")


def _to_float(v: str) -> Optional[float]:
    v = _clean(v) or ""
    try:
        return float(v)
    except ValueError:
        return None


def _to_date(v: str) -> Optional[str]:
    v = _clean(v) or ""
    for fmt in ("%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_navall(text: str) -> list[RawScheme]:
    schemes: list[RawScheme] = []
    current_category: Optional[str] = None
    current_house: Optional[str] = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if _SCHEME_ROW.match(line):
            parts = line.split(";")
            # AMFI historically used 6 columns:
            #   code;isin1;isin2;name;nav;date
            # The current feed uses 8, splitting plan/option out of the name:
            #   code;isin1;isin2;name;plan;option;nav;date
            if len(parts) >= 8:
                code, isin1, _isin2, name, plan, option, nav, ndate = parts[:8]
                # Fold plan/option back into a single display name so downstream
                # DIRECT/GROWTH/IDCW detection on `name` keeps working.
                full_name = " - ".join(
                    p.strip() for p in (name, plan, option) if _clean(p)
                )
            elif len(parts) >= 6:
                code, isin1, _isin2, name, nav, ndate = parts[:6]
                full_name = name.strip()
            else:
                continue
            bucket = _bucket_for(current_category)
            schemes.append(
                RawScheme(
                    scheme_code=int(code),
                    isin=_clean(isin1),
                    name=full_name,
                    nav=_to_float(nav),
                    nav_date=_to_date(ndate),
                    fund_house=current_house,
                    category=current_category,
                    bucket=bucket,
                )
            )
            continue
        m = re.match(r"^(.*?)\((.*)\)\s*$", line)
        if m and ("Scheme" in m.group(1) or "Schemes" in m.group(1)):
            current_category = m.group(2).strip()
            continue
        if not line.lower().startswith("scheme code"):
            current_house = line
    return schemes


def shortlist(schemes: list[RawScheme]) -> list[RawScheme]:
    """Prefer Direct + Growth plans within recognized buckets."""
    picked: list[RawScheme] = []
    for s in schemes:
        if s.bucket is None or s.nav is None:
            continue
        upper = s.name.upper()
        # Drop segregated / side-pocketed portfolios (defaulted debt carved out of
        # a scheme). Their NAVs are distressed and produce nonsense metrics.
        if "SEGREGATED" in upper or "SIDE POCKET" in upper or "SIDEPOCKET" in upper:
            continue
        # Growth only (compare total return, not IDCW).
        if "IDCW" in upper or "DIVIDEND" in upper or "PAYOUT" in upper or "RE-INVESTMENT" in upper or "REINVESTMENT" in upper:
            continue
        # We distribute REGULAR plans only, so the research board reflects the
        # exact plans a customer can buy here. Skip Direct plans entirely.
        if "DIRECT" in upper:
            continue
        # Keep Regular plans (explicitly labelled) and older schemes with no
        # plan label (which predate the Direct/Regular split and are Regular).
        picked.append(s)
    return picked


def compute_metrics(series: list[tuple[date, float]]) -> dict:
    """Trailing returns, CAGR, annualized volatility, max drawdown."""
    out: dict = {
        "return_1y": None,
        "return_3y": None,
        "return_5y": None,
        "cagr_since_inception": None,
        "volatility": None,
        "max_drawdown": None,
        "inception_date": None,
        "history_points": len(series),
    }
    if len(series) < 2:
        return out
    series = sorted(series, key=lambda x: x[0])
    inception, first_nav = series[0]
    latest_date, latest_nav = series[-1]
    out["inception_date"] = inception.isoformat()
    if latest_nav <= 0 or first_nav <= 0:
        return out

    def nav_before(days: int) -> Optional[float]:
        target = latest_date.toordinal() - days
        chosen = None
        for d, nav in series:
            if d.toordinal() <= target:
                chosen = nav
            else:
                break
        return chosen

    for key, days in (("return_1y", 365), ("return_3y", 365 * 3), ("return_5y", 365 * 5)):
        past = nav_before(days)
        if past and past > 0:
            years = days / 365
            if years <= 1:
                out[key] = round((latest_nav / past - 1) * 100, 2)
            else:
                out[key] = round(((latest_nav / past) ** (1 / years) - 1) * 100, 2)

    span_years = (latest_date - inception).days / 365.25
    if span_years >= 0.5:
        out["cagr_since_inception"] = round(
            ((latest_nav / first_nav) ** (1 / span_years) - 1) * 100, 2
        )

    # Volatility from ~3y of monthly-sampled log returns.
    recent = [nav for d, nav in series if (latest_date - d).days <= 365 * 3]
    if len(recent) > 30:
        rets = [
            math.log(recent[i] / recent[i - 1])
            for i in range(1, len(recent))
            if recent[i - 1] > 0 and recent[i] > 0
        ]
        if len(rets) > 2:
            mean = sum(rets) / len(rets)
            var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
            out["volatility"] = round(math.sqrt(var) * math.sqrt(252) * 100, 2)

    peak = series[0][1]
    max_dd = 0.0
    for _, nav in series:
        peak = max(peak, nav)
        if peak > 0:
            max_dd = min(max_dd, nav / peak - 1)
    out["max_drawdown"] = round(max_dd * 100, 2)
    return out


def fetch_history(code: int, client: httpx.Client) -> list[tuple[date, float]]:
    try:
        r = client.get(MFAPI_SCHEME_URL.format(code=code), timeout=30)
        r.raise_for_status()
        data = r.json().get("data") or []
    except Exception:
        return []
    series: list[tuple[date, float]] = []
    for pt in data:
        d = _to_date(pt.get("date", ""))
        nav = _to_float(pt.get("nav", ""))
        if d and nav:
            series.append((date.fromisoformat(d), nav))
    return series


def score_fund(f: ScoredFund) -> None:
    """Composite score (higher = better), plus a 1-5 star rating and signals.

    Weighs risk-adjusted long-run return the most, then medium-term return,
    penalizes deep drawdowns. This is deliberately transparent, not a black box.
    """
    r1 = f.return_1y or 0
    # Do NOT substitute 1Y for a missing 3Y/5Y — that lets a fund with one hot
    # year leapfrog established performers. Missing long-run data scores as 0 and
    # earns a track-record penalty below.
    r3 = f.return_3y if f.return_3y is not None else 0
    r5 = f.return_5y if f.return_5y is not None else 0
    vol = f.volatility or (18 if f.asset_class == "equity" else 6)
    dd = f.max_drawdown or 0

    has_3y = f.return_3y is not None
    has_5y = f.return_5y is not None

    # Sanity clamps so distressed/noisy NAV series can't top the ranking.
    # Realistic annualized vol ceilings by asset class; anything above is noise.
    vol_ceiling = {"equity": 45.0, "hybrid": 30.0, "gold": 35.0, "debt": 15.0}.get(
        f.asset_class, 45.0
    )
    if vol > vol_ceiling or (f.return_1y is not None and abs(f.return_1y) > 150):
        f.score = -999.0
        f.signals.append("Excluded: anomalous NAV series")
        return

    # Risk-adjusted: return per unit of volatility (Sharpe-like, rf ~ 6%).
    # Floor the volatility so near-cash funds (vol ~ 0.1%) don't produce an
    # explosive Sharpe that lets liquid funds dominate an equity-oriented board.
    rf = 6.0
    vol_floor = max(vol, 4.0)
    risk_adj = (r3 - rf) / vol_floor

    # Absolute long-run return carries the most weight — a research dashboard's
    # "top funds" should reflect wealth creation, tempered by risk-adjustment and
    # drawdown, not reward capital-preservation vehicles for having no volatility.
    score = 0.0
    score += 0.55 * r5
    score += 0.35 * r3
    score += 0.10 * r1
    score += 3.0 * risk_adj
    score += 0.04 * dd  # dd is negative -> penalty
    # Track-record penalty: a fund without 3Y (and especially 5Y) history is less
    # trustworthy for a "best funds" board. This keeps hot new launches from
    # topping the list on a single lucky year.
    if not has_3y:
        score -= 6.0
    if not has_5y:
        score -= 3.0
    if f.history_points < 400:
        score -= 2.0
    f.score = round(score, 3)

    # Signals: transparent "what to invest / what not" cues (SPEC-of-request).
    if risk_adj >= 0.6:
        f.signals.append("Strong risk-adjusted returns")
    if (f.return_5y or 0) >= 15 and f.asset_class == "equity":
        f.signals.append("Consistent long-term compounding")
    if dd <= -45:
        f.signals.append("Deep past drawdown — high volatility")
    if vol >= 25:
        f.signals.append("High volatility")
    if f.history_points < 400:
        f.signals.append("Limited track record")
    if f.asset_class == "debt" and (f.volatility or 0) <= 3:
        f.signals.append("Low-risk / capital preservation")


def assign_ratings(funds: list[ScoredFund]) -> None:
    """Star rating (1-5) assigned by score percentile WITHIN each bucket."""
    from collections import defaultdict

    by_bucket: dict[str, list[ScoredFund]] = defaultdict(list)
    for f in funds:
        by_bucket[f.bucket].append(f)
    for bucket_funds in by_bucket.values():
        ordered = sorted(bucket_funds, key=lambda x: x.score, reverse=True)
        n = len(ordered)
        for i, f in enumerate(ordered):
            pct = i / n if n > 1 else 0
            if pct < 0.10:
                f.rating = 5
            elif pct < 0.30:
                f.rating = 4
            elif pct < 0.65:
                f.rating = 3
            elif pct < 0.90:
                f.rating = 2
            else:
                f.rating = 1


def build_top_funds(dry: bool = False, max_fetch_per_bucket: int = 120) -> list[ScoredFund]:
    print("Fetching AMFI NAVAll…", file=sys.stderr)
    with httpx.Client(follow_redirects=True) as client:
        resp = client.get(AMFI_NAV_ALL_URL, timeout=90)
        resp.raise_for_status()
        raw = parse_navall(resp.text)
    print(f"  parsed {len(raw)} schemes", file=sys.stderr)

    picked = shortlist(raw)
    print(f"  shortlisted {len(picked)} (direct+growth, recognized buckets)", file=sys.stderr)

    # Group by bucket; cap how many we fetch history for per bucket to stay fast.
    from collections import defaultdict

    by_bucket: dict[str, list[RawScheme]] = defaultdict(list)
    for s in picked:
        by_bucket[s.bucket].append(s)

    to_fetch: list[RawScheme] = []
    for bucket, items in by_bucket.items():
        keep = CATEGORY_BUCKETS.get(bucket, 30)
        # Fetch a bit more than we keep so ranking has room; bounded for speed.
        limit = min(len(items), max(keep + 30, max_fetch_per_bucket))
        to_fetch.extend(items[:limit])

    print(f"  fetching history for {len(to_fetch)} funds (threaded)…", file=sys.stderr)
    scored: list[ScoredFund] = []
    with httpx.Client() as client:
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = {
                pool.submit(fetch_history, s.scheme_code, client): s for s in to_fetch
            }
            done = 0
            for fut in as_completed(futures):
                s = futures[fut]
                series = fut.result()
                done += 1
                if done % 100 == 0:
                    print(f"    {done}/{len(to_fetch)}", file=sys.stderr)
                if len(series) < 60:  # need a minimum history to be meaningful
                    continue
                m = compute_metrics(series)
                plan = "REGULAR"
                sf = ScoredFund(
                    scheme_code=s.scheme_code,
                    isin=s.isin,
                    name=_display_name(s.name),
                    fund_house=s.fund_house,
                    category=s.category or s.bucket,
                    bucket=s.bucket,
                    asset_class=_asset_class_for(s.bucket),
                    plan=plan,
                    nav=s.nav or (series[-1][1] if series else 0),
                    nav_date=s.nav_date,
                    **m,
                )
                score_fund(sf)
                scored.append(sf)

    # Rank within bucket, keep top-N per bucket, trim to TARGET_TOTAL.
    from collections import defaultdict as dd2

    grouped: dict[str, list[ScoredFund]] = dd2(list)
    for f in scored:
        grouped[f.bucket].append(f)

    final: list[ScoredFund] = []
    for bucket, items in grouped.items():
        keep = CATEGORY_BUCKETS.get(bucket, 30)
        # Drop anomalous (distressed/noisy) funds before ranking.
        items = [f for f in items if f.score > -900]
        items.sort(key=lambda x: x.score, reverse=True)
        final.extend(items[:keep])

    final.sort(key=lambda x: x.score, reverse=True)
    final = final[:TARGET_TOTAL]
    assign_ratings(final)

    print(f"  final set: {len(final)} funds across {len(grouped)} buckets", file=sys.stderr)
    return final


def to_row(f: ScoredFund) -> dict:
    return {
        "scheme_code": f.scheme_code,
        "isin": f.isin,
        "name": f.name,
        "fund_house": f.fund_house,
        "category": f.category,
        "bucket": f.bucket,
        "asset_class": f.asset_class,
        "plan": f.plan,
        "nav": f.nav,
        "nav_date": f.nav_date,
        "return_1y": f.return_1y,
        "return_3y": f.return_3y,
        "return_5y": f.return_5y,
        "cagr_since_inception": f.cagr_since_inception,
        "volatility": f.volatility,
        "max_drawdown": f.max_drawdown,
        "inception_date": f.inception_date,
        "history_points": f.history_points,
        "score": f.score,
        "rating": f.rating,
        "signals": f.signals,
    }


import json
import os

# Local cache so the dashboard works even before Supabase is configured.
CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "dashboard_funds.json")


def write_cache(funds: list[ScoredFund]) -> None:
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as fh:
        json.dump([to_row(f) for f in funds], fh, ensure_ascii=False)
    print(f"Wrote local cache: {CACHE_PATH} ({len(funds)} funds)", file=sys.stderr)


def upsert_to_supabase(funds: list[ScoredFund]) -> None:
    from app.supabase_client import get_supabase

    sb = get_supabase()
    rows = [to_row(f) for f in funds]
    # Replace the table contents: delete-all then insert in batches.
    sb.table("dashboard_funds").delete().neq("scheme_code", -1).execute()
    for i in range(0, len(rows), 200):
        sb.table("dashboard_funds").insert(rows[i : i + 200]).execute()
    print(f"Upserted {len(rows)} funds to Supabase dashboard_funds", file=sys.stderr)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="compute only, no DB writes")
    args = parser.parse_args(argv)

    start = time.time()
    funds = build_top_funds(dry=args.dry)
    elapsed = time.time() - start

    # Print a category summary.
    from collections import Counter

    counts = Counter(f.bucket for f in funds)
    print("\n=== Top funds by bucket ===", file=sys.stderr)
    for bucket, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {bucket:24s} {n}", file=sys.stderr)
    top5 = sorted(funds, key=lambda x: x.score, reverse=True)[:5]
    print("\n=== Top 5 overall ===", file=sys.stderr)
    for f in top5:
        print(
            f"  [{f.rating}★] {f.name[:50]:50s} 3Y={f.return_3y} vol={f.volatility} score={f.score}",
            file=sys.stderr,
        )
    print(f"\nDone in {elapsed:.1f}s", file=sys.stderr)

    # Always write the local cache so the dashboard has data even without Supabase.
    write_cache(funds)

    if not args.dry:
        try:
            upsert_to_supabase(funds)
        except Exception as exc:  # noqa: BLE001
            print(f"Supabase write skipped/failed ({exc}); local cache is ready.", file=sys.stderr)
    else:
        print("(--dry: skipped Supabase write; local cache still written)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
