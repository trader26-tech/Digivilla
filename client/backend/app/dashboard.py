"""Dashboard data access + assembly.

Reads the ranked top-~1000 fund set from Supabase (`dashboard_funds` table) when
configured, otherwise from the local JSON cache written by app.ingest. This means
the research dashboard renders out-of-the-box after a single ingest run, with or
without Supabase.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Optional

from app.schemas import (
    BucketGroup,
    DashboardFund,
    DashboardOverview,
    FundDetail,
    NavPoint,
)

CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "dashboard_funds.json")

# Display order for buckets in the UI (equity-forward, then hybrid, debt, gold).
BUCKET_ORDER = [
    "Flexi Cap",
    "Large Cap",
    "Large & Mid Cap",
    "Mid Cap",
    "Small Cap",
    "Multi Cap",
    "Focused",
    "Value / Contra",
    "ELSS",
    "Sectoral / Thematic",
    "Index / ETF",
    "Aggressive Hybrid",
    "Balanced Advantage",
    "Multi Asset",
    "Conservative Hybrid",
    "Corporate Bond",
    "Short / Low Duration",
    "Gilt",
    "Liquid / Overnight",
    "Gold",
]


def _load_rows() -> list[dict]:
    # Prefer Supabase when available.
    try:
        from app.supabase_client import get_supabase

        resp = get_supabase().table("dashboard_funds").select("*").execute()
        rows = resp.data or []
        if rows:
            return rows
    except Exception:
        pass
    # Fall back to the local cache.
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    return []


@lru_cache(maxsize=1)
def _cached_rows() -> tuple[dict, ...]:
    return tuple(_load_rows())


def refresh_cache() -> None:
    _cached_rows.cache_clear()


def _to_fund(row: dict) -> DashboardFund:
    return DashboardFund(
        scheme_code=row["scheme_code"],
        isin=row.get("isin"),
        name=row["name"],
        fund_house=row.get("fund_house"),
        category=row.get("category") or row.get("bucket") or "",
        bucket=row.get("bucket") or "",
        asset_class=row.get("asset_class") or "equity",
        plan=row.get("plan") or "",
        nav=row.get("nav"),
        nav_date=row.get("nav_date"),
        return_1y=row.get("return_1y"),
        return_3y=row.get("return_3y"),
        return_5y=row.get("return_5y"),
        cagr_since_inception=row.get("cagr_since_inception"),
        volatility=row.get("volatility"),
        max_drawdown=row.get("max_drawdown"),
        inception_date=row.get("inception_date"),
        history_points=row.get("history_points") or 0,
        score=row.get("score") or 0.0,
        rating=row.get("rating") or 3,
        signals=row.get("signals") or [],
    )


def all_funds() -> list[DashboardFund]:
    return [_to_fund(r) for r in _cached_rows()]


def get_overview() -> DashboardOverview:
    funds = all_funds()
    by_bucket: dict[str, list[DashboardFund]] = {}
    for f in funds:
        by_bucket.setdefault(f.bucket, []).append(f)

    for items in by_bucket.values():
        items.sort(key=lambda x: x.score, reverse=True)

    ordered_buckets = [b for b in BUCKET_ORDER if b in by_bucket]
    ordered_buckets += [b for b in by_bucket if b not in BUCKET_ORDER]

    groups = [
        BucketGroup(
            bucket=b,
            asset_class=by_bucket[b][0].asset_class if by_bucket[b] else "equity",
            count=len(by_bucket[b]),
            funds=by_bucket[b][:8],  # preview; full list via /funds?bucket=
        )
        for b in ordered_buckets
    ]

    top_overall = sorted(funds, key=lambda x: x.score, reverse=True)[:10]
    top_gainers = sorted(
        [f for f in funds if f.return_1y is not None],
        key=lambda x: x.return_1y or 0,
        reverse=True,
    )[:10]
    lowest_risk = sorted(
        [f for f in funds if f.volatility is not None and f.asset_class != "debt"],
        key=lambda x: x.volatility or 999,
    )[:10]

    nav_dates = [f.nav_date for f in funds if f.nav_date]
    fund_houses = len({f.fund_house for f in funds if f.fund_house})

    return DashboardOverview(
        total_funds=len(funds),
        total_buckets=len(by_bucket),
        fund_houses=fund_houses,
        updated_nav_date=max(nav_dates) if nav_dates else None,
        top_overall=top_overall,
        top_gainers_1y=top_gainers,
        lowest_risk=lowest_risk,
        buckets=groups,
    )


def list_funds(
    bucket: Optional[str] = None,
    q: Optional[str] = None,
    asset_class: Optional[str] = None,
    sort: str = "score",
    limit: int = 60,
    offset: int = 0,
) -> tuple[int, list[DashboardFund]]:
    funds = all_funds()
    if bucket:
        funds = [f for f in funds if f.bucket == bucket]
    if asset_class:
        funds = [f for f in funds if f.asset_class == asset_class]
    if q:
        ql = q.lower()
        funds = [
            f
            for f in funds
            if ql in f.name.lower() or (f.fund_house and ql in f.fund_house.lower())
        ]

    key = {
        "score": lambda x: -x.score,
        "return_1y": lambda x: -(x.return_1y or -999),
        "return_3y": lambda x: -(x.return_3y or -999),
        "return_5y": lambda x: -(x.return_5y or -999),
        "volatility": lambda x: (x.volatility or 999),
        "rating": lambda x: -x.rating,
    }.get(sort, lambda x: -x.score)
    funds.sort(key=key)

    total = len(funds)
    return total, funds[offset : offset + limit]


def _verdict(f: DashboardFund) -> tuple[str, str]:
    """Plain-language 'what to know' verdict for a fund."""
    good = []
    caution = []
    if f.rating >= 4:
        good.append("top-rated within its category")
    if f.return_5y is not None and f.return_5y >= 15 and f.asset_class == "equity":
        good.append(f"strong 5-year CAGR of {f.return_5y:.1f}%")
    if f.volatility is not None and f.asset_class == "equity" and f.volatility <= 16:
        good.append("relatively low volatility for equity")
    if f.max_drawdown is not None and f.max_drawdown <= -50:
        caution.append(f"has fallen {abs(f.max_drawdown):.0f}% peak-to-trough historically")
    if f.volatility is not None and f.volatility >= 28:
        caution.append("high volatility — expect sharp swings")
    if f.history_points < 400:
        caution.append("limited track record")
    if f.bucket == "Sectoral / Thematic":
        caution.append("concentrated sector bet — not a core holding")

    tone = "good" if f.rating >= 4 and not caution else ("caution" if caution else "neutral")
    parts = []
    if good:
        parts.append("Strengths: " + "; ".join(good) + ".")
    if caution:
        parts.append("Watch-outs: " + "; ".join(caution) + ".")
    if not parts:
        parts.append("A middle-of-the-pack option in its category.")
    return " ".join(parts), tone


def get_fund_detail(scheme_code: int) -> Optional[FundDetail]:
    funds = all_funds()
    match = next((f for f in funds if f.scheme_code == scheme_code), None)
    if match is None:
        return None

    peers = sorted(
        [f for f in funds if f.bucket == match.bucket and f.scheme_code != scheme_code],
        key=lambda x: x.score,
        reverse=True,
    )[:5]

    history = _fetch_nav_history(scheme_code)
    verdict, tone = _verdict(match)

    return FundDetail(
        **match.model_dump(),
        nav_history=history,
        peers=peers,
        verdict=verdict,
        verdict_tone=tone,
    )


def _fetch_full_nav(scheme_code: int) -> list[NavPoint]:
    """Full live NAV history from mfapi, ascending by date."""
    try:
        import httpx

        r = httpx.get(f"https://api.mfapi.in/mf/{scheme_code}", timeout=25)
        r.raise_for_status()
        data = r.json().get("data") or []
    except Exception:
        return []
    from datetime import datetime

    parsed: list[NavPoint] = []
    for pt in data:
        try:
            d = datetime.strptime(pt["date"], "%d-%m-%Y").date().isoformat()
            parsed.append(NavPoint(date=d, nav=float(pt["nav"])))
        except (ValueError, KeyError):
            continue
    parsed.sort(key=lambda x: x.date)
    return parsed


def _fetch_nav_history(scheme_code: int, points: int = 260) -> list[NavPoint]:
    """Sampled NAV history for the compact detail chart (back-compat)."""
    parsed = _fetch_full_nav(scheme_code)
    if len(parsed) > points:
        step = len(parsed) // points
        parsed = parsed[::step]
    return parsed


def _sample(points: list[NavPoint], target: int = 200) -> list[NavPoint]:
    if len(points) <= target:
        return points
    step = len(points) // target
    sampled = points[::step]
    if sampled[-1] is not points[-1]:
        sampled.append(points[-1])  # always keep the latest point
    return sampled


def get_nav_windows(scheme_code: int) -> Optional["NavHistoryResponse"]:
    """Full NAV history sliced into 1Y / 3Y / 5Y / max windows with returns."""
    from datetime import date, timedelta

    from app.schemas import NavHistoryResponse, NavWindow

    fund = next((f for f in all_funds() if f.scheme_code == scheme_code), None)
    full = _fetch_full_nav(scheme_code)
    if not full:
        return None

    latest = full[-1]
    latest_date = date.fromisoformat(latest.date)

    specs = [("1y", 365), ("3y", 365 * 3), ("5y", 365 * 5), ("max", None)]
    windows: list[NavWindow] = []
    for name, days in specs:
        if days is None:
            series = full
        else:
            cutoff = (latest_date - timedelta(days=days)).isoformat()
            series = [p for p in full if p.date >= cutoff]
        if len(series) < 2:
            continue
        start_nav = series[0].nav
        end_nav = series[-1].nav
        change = (end_nav / start_nav - 1) * 100 if start_nav > 0 else None
        # Annualize for windows >= 1y.
        span_years = (
            date.fromisoformat(series[-1].date) - date.fromisoformat(series[0].date)
        ).days / 365.25
        cagr = (
            round(((end_nav / start_nav) ** (1 / span_years) - 1) * 100, 2)
            if start_nav > 0 and span_years >= 1
            else None
        )
        navs = [p.nav for p in series]
        windows.append(
            NavWindow(
                window=name,
                points=_sample(series),
                start_nav=round(start_nav, 4),
                end_nav=round(end_nav, 4),
                change_pct=round(change, 2) if change is not None else None,
                cagr_pct=cagr,
                high=round(max(navs), 4),
                low=round(min(navs), 4),
            )
        )

    return NavHistoryResponse(
        scheme_code=scheme_code,
        name=fund.name if fund else str(scheme_code),
        current_nav=latest.nav,
        nav_date=latest.date,
        windows=windows,
    )
