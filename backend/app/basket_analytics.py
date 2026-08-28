"""Basket analytics from REAL blended NAV history.

Given a set of (scheme_code, weight) funds, we:
  1. fetch each fund's NAV history,
  2. align them on common dates,
  3. build a synthetic "basket NAV" as the weighted sum of each fund's growth,
  4. compute the basket's actual historical metrics: 1Y/3Y/5Y returns, CAGR,
     annualized volatility, and max drawdown,
  5. derive an expected forward return + optimistic/pessimistic band,
  6. score diversification from asset-class spread and fund count.

This is the honest way to answer "what is the drawdown/volatility of THIS mix",
because it captures how the funds actually moved together — not a naive average.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

import httpx
from pydantic import BaseModel

from app import dashboard

MFAPI_URL = "https://api.mfapi.in/mf/{code}"


class GrowthPoint(BaseModel):
    date: str  # 'YYYY-MM'
    value: float  # basket value, starting from a base investment
    drawdown: float  # % below running peak at this point (<= 0)
    move: float = 0.0  # this month's basket return %
    driver: Optional[str] = None  # asset class that drove this move most
    driver_pct: Optional[float] = None  # that asset class's contribution %


class YearReturn(BaseModel):
    year: str
    ret: float  # % return for that calendar year


class BasketMetrics(BaseModel):
    return_1y: Optional[float] = None
    return_3y: Optional[float] = None
    return_5y: Optional[float] = None
    cagr: Optional[float] = None
    volatility: Optional[float] = None
    max_drawdown: Optional[float] = None
    expected_return: Optional[float] = None  # forward, annual %
    expected_low: Optional[float] = None  # 1-yr band low %
    expected_high: Optional[float] = None  # 1-yr band high %
    diversification: int = 0  # 0..100
    diversification_label: str = ""
    asset_mix: dict = {}  # asset_class -> weight %
    history_years: float = 0.0
    fund_count: int = 0
    # Visual evidence (populated when include_series=True).
    base_investment: float = 0.0
    growth: list[GrowthPoint] = []
    worst_drawdown_date: Optional[str] = None
    yearly_returns: list[YearReturn] = []
    # Forward Monte Carlo projection (lump sum), populated when include_series=True.
    projection: Optional["Projection"] = None
    # Smallest lump sum where every fund clears its own minimum purchase.
    min_investment: float = 0.0


class ProjPoint(BaseModel):
    year: int
    p10: float
    p50: float
    p90: float
    # Wider fan for the Monte Carlo chart (5th/25th/75th/95th percentiles).
    p5: float = 0.0
    p25: float = 0.0
    p75: float = 0.0
    p95: float = 0.0


class Projection(BaseModel):
    base: float  # lump sum invested today
    years: int
    points: list[ProjPoint]
    final_p10: float
    final_p50: float
    final_p90: float
    # Monte Carlo provenance/quality, for the "how probable" story on the UI.
    sims: int = 0
    prob_gain: Optional[float] = None  # P(ends above what you put in), %
    prob_double: Optional[float] = None  # P(ends >= 2x the base), %
    expected_multiple: Optional[float] = None  # median end value / base
    # A handful of full simulated paths (base=100), so the UI can draw the
    # spaghetti/fan behind the percentile band. Downsampled for payload size.
    sample_paths: list[list[float]] = []


def _fetch_series(code: int) -> list[tuple[date, float]]:
    try:
        r = httpx.get(MFAPI_URL.format(code=code), timeout=25)
        r.raise_for_status()
        data = r.json().get("data") or []
    except Exception:
        return []
    from datetime import datetime

    out = []
    for pt in data:
        try:
            d = datetime.strptime(pt["date"], "%d-%m-%Y").date()
            out.append((d, float(pt["nav"])))
        except (ValueError, KeyError):
            continue
    out.sort(key=lambda x: x[0])
    return out


def _months_between(a: str, b: str) -> int:
    ay, am = map(int, a.split("-"))
    by, bm = map(int, b.split("-"))
    return abs((by - ay) * 12 + (bm - am))


def _monthly(series: list[tuple[date, float]]) -> dict[str, float]:
    """Reduce a daily series to end-of-month NAVs keyed 'YYYY-MM'."""
    by_month: dict[str, float] = {}
    for d, nav in series:
        by_month[f"{d.year}-{d.month:02d}"] = nav  # last write wins = month end
    return by_month


def analyze(items: list[dict], include_series: bool = False) -> BasketMetrics:
    """items: [{scheme_code, weight, asset_class?}]. Weights need not sum to 1."""
    funds = {f.scheme_code: f for f in dashboard.all_funds()}
    weights: dict[int, float] = {}
    for it in items:
        code = int(it["scheme_code"])
        weights[code] = weights.get(code, 0) + float(it.get("weight", 0))
    total_w = sum(weights.values()) or 1
    weights = {c: w / total_w for c, w in weights.items()}

    # Fetch all series in parallel.
    codes = list(weights.keys())
    with ThreadPoolExecutor(max_workers=min(8, len(codes) or 1)) as pool:
        series_list = list(pool.map(_fetch_series, codes))
    monthlies = {c: _monthly(s) for c, s in zip(codes, series_list) if s}

    # Drop funds whose history is stale (last point older than ~3 months). Some
    # AMFI codes map to merged/dormant schemes on mfapi with truncated history;
    # including them would collapse the common-date intersection to nothing.
    if monthlies:
        latest_month = max(max(m.keys()) for m in monthlies.values())
        fresh = {}
        for c, m in monthlies.items():
            newest = max(m.keys())
            # keep if within ~3 months of the freshest fund
            if _months_between(newest, latest_month) <= 3:
                fresh[c] = m
        monthlies = fresh

    metrics = BasketMetrics(fund_count=len(codes))

    # Asset mix + diversification (works even without price history).
    asset_mix: dict[str, float] = {}
    for c, w in weights.items():
        f = funds.get(c)
        ac = f.asset_class if f else "equity"
        asset_mix[ac] = asset_mix.get(ac, 0) + w * 100
    metrics.asset_mix = {k: round(v, 1) for k, v in asset_mix.items()}
    metrics.diversification, metrics.diversification_label = _diversification(
        weights, funds
    )
    metrics.min_investment = _min_investment(weights, funds)

    if not monthlies:
        return metrics

    # Common set of months across all funds that have history.
    common = set.intersection(*[set(m.keys()) for m in monthlies.values()])
    if len(common) < 13:
        # Not enough overlap for reliable metrics; still return mix/diversification.
        return metrics
    months = sorted(common)

    # Build basket index: start at 100, grow by weighted monthly returns.
    active_codes = [c for c in codes if c in monthlies]
    active_w = {c: weights[c] for c in active_codes}
    aw_total = sum(active_w.values()) or 1
    active_w = {c: w / aw_total for c, w in active_w.items()}

    # Per-month asset-class contribution (weighted return by asset class), used
    # for "what drove this move" attribution on hover.
    ac_of = {c: (funds.get(c).asset_class if funds.get(c) else "equity") for c in active_codes}
    index = [100.0]
    contrib_by_month: list[dict[str, float]] = [{}]  # month 0 has no move
    for i in range(1, len(months)):
        prev_m, cur_m = months[i - 1], months[i]
        port_ret = 0.0
        contrib: dict[str, float] = {}
        for c in active_codes:
            p0 = monthlies[c][prev_m]
            p1 = monthlies[c][cur_m]
            if p0 > 0:
                cr = active_w[c] * (p1 / p0 - 1)
                port_ret += cr
                contrib[ac_of[c]] = contrib.get(ac_of[c], 0.0) + cr
        index.append(index[-1] * (1 + port_ret))
        contrib_by_month.append(contrib)
    self_contrib = contrib_by_month  # captured by _attach_series via closure param

    metrics.history_years = round(len(months) / 12, 1)

    # Trailing returns from the basket index.
    def ret_over(months_back: int) -> Optional[float]:
        if len(index) <= months_back:
            return None
        past = index[-1 - months_back]
        if past <= 0:
            return None
        years = months_back / 12
        if years <= 1:
            return round((index[-1] / past - 1) * 100, 2)
        return round(((index[-1] / past) ** (1 / years) - 1) * 100, 2)

    metrics.return_1y = ret_over(12)
    metrics.return_3y = ret_over(36)
    metrics.return_5y = ret_over(60)
    span_years = len(index) / 12
    if index[0] > 0 and span_years >= 1:
        metrics.cagr = round(((index[-1] / index[0]) ** (1 / span_years) - 1) * 100, 2)

    # Volatility from monthly returns (annualized).
    rets = [index[i] / index[i - 1] - 1 for i in range(1, len(index)) if index[i - 1] > 0]
    if len(rets) > 2:
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        vol_annual = math.sqrt(var) * math.sqrt(12) * 100
        metrics.volatility = round(vol_annual, 2)

    # Max drawdown on the basket index.
    peak = index[0]
    max_dd = 0.0
    for v in index:
        peak = max(peak, v)
        if peak > 0:
            max_dd = min(max_dd, v / peak - 1)
    metrics.max_drawdown = round(max_dd * 100, 2)

    # Forward expectation: blend of a category-based prior and observed CAGR,
    # with a 1-sigma band from volatility (honest, simple).
    prior = _expected_prior(weights, funds)
    observed = metrics.cagr if metrics.cagr is not None else prior
    expected = round(0.5 * prior + 0.5 * observed, 2)
    metrics.expected_return = expected
    if metrics.volatility is not None:
        metrics.expected_low = round(expected - metrics.volatility, 2)
        metrics.expected_high = round(expected + metrics.volatility, 2)

    if include_series:
        _attach_series(metrics, months, index, self_contrib)
        metrics.projection = _project(
            metrics.expected_return, metrics.volatility, base=10000.0, years=10
        )
    return metrics


def _min_investment(weights: dict[int, float], funds) -> float:
    """Smallest lump where every fund clears its own minimum purchase.

    If fund f has weight w and minimum m, the lump L must satisfy L*w >= m for
    all funds, i.e. L >= max(m / w). Rounded up to a clean ₹100.
    """
    # Most regular-plan growth schemes have a ₹500 minimum lump purchase.
    per_fund_min = 500.0
    need = 0.0
    for c, w in weights.items():
        if w <= 0:
            continue
        need = max(need, per_fund_min / w)
    if need <= 0:
        need = per_fund_min
    return float(math.ceil(need / 100) * 100)


def _project(expected_return, volatility, base: float, years: int) -> "Projection":
    """Lognormal Monte Carlo of a lump sum, annual steps, p10/p50/p90 band."""
    import numpy as np

    er = (expected_return if expected_return is not None else 10.0) / 100
    vol = (volatility if volatility is not None else 14.0) / 100
    sims = 4000
    rng = np.random.default_rng(7)
    balances = np.full(sims, base)
    points = [ProjPoint(year=0, p10=base, p50=base, p90=base)]
    for y in range(1, years + 1):
        shocks = rng.normal(loc=er, scale=vol, size=sims)
        balances = balances * (1 + shocks)
        balances = np.maximum(balances, 0)
        points.append(
            ProjPoint(
                year=y,
                p10=round(float(np.percentile(balances, 10))),
                p50=round(float(np.percentile(balances, 50))),
                p90=round(float(np.percentile(balances, 90))),
            )
        )
    return Projection(
        base=base,
        years=years,
        points=points,
        final_p10=points[-1].p10,
        final_p50=points[-1].p50,
        final_p90=points[-1].p90,
    )


def _attach_series(
    metrics: BasketMetrics,
    months: list[str],
    index: list[float],
    contrib_by_month: list[dict[str, float]],
) -> None:
    """Build the visual-evidence series: growth of a base investment, the
    underwater/drawdown curve, and calendar-year returns."""
    base = 10000.0
    metrics.base_investment = base
    scale = base / index[0] if index[0] > 0 else 1

    peak = index[0]
    worst_dd = 0.0
    worst_date = None
    growth: list[GrowthPoint] = []
    for idx, (m, v) in enumerate(zip(months, index)):
        peak = max(peak, v)
        dd = (v / peak - 1) * 100 if peak > 0 else 0.0
        if dd < worst_dd:
            worst_dd = dd
            worst_date = m
        move = (v / index[idx - 1] - 1) * 100 if idx > 0 and index[idx - 1] > 0 else 0.0
        # Which asset class drove this month's move most (by absolute contribution).
        contrib = contrib_by_month[idx] if idx < len(contrib_by_month) else {}
        driver = None
        driver_pct = None
        if contrib:
            driver = max(contrib.items(), key=lambda kv: abs(kv[1]))[0]
            driver_pct = round(contrib[driver] * 100, 2)
        growth.append(
            GrowthPoint(
                date=m,
                value=round(v * scale, 2),
                drawdown=round(dd, 2),
                move=round(move, 2),
                driver=driver,
                driver_pct=driver_pct,
            )
        )
    metrics.growth = growth
    metrics.worst_drawdown_date = worst_date

    # Calendar-year returns: each year's return = year-end vs previous year-end
    # (first year uses the series start as its base).
    year_end: dict[str, float] = {}
    for m, v in zip(months, index):
        year_end[m[:4]] = v  # last observed month of each year wins
    years = sorted(year_end.keys())
    yearly: list[YearReturn] = []
    base_val = index[0]
    for y in years:
        end = year_end[y]
        if base_val > 0:
            yearly.append(YearReturn(year=y, ret=round((end / base_val - 1) * 100, 1)))
        base_val = end
    metrics.yearly_returns = yearly


# Long-run expected annual return priors by asset class (%).
_ASSET_PRIOR = {"equity": 12.0, "hybrid": 10.0, "gold": 8.0, "debt": 6.8}


def _expected_prior(weights: dict[int, float], funds) -> float:
    total = 0.0
    for c, w in weights.items():
        f = funds.get(c)
        ac = f.asset_class if f else "equity"
        total += w * _ASSET_PRIOR.get(ac, 10.0)
    return round(total, 2)


def _diversification(weights: dict[int, float], funds) -> tuple[int, str]:
    """Score 0-100 from asset-class spread, category spread, and concentration."""
    if not weights:
        return 0, "Empty"
    asset_classes = set()
    buckets = set()
    for c in weights:
        f = funds.get(c)
        if f:
            asset_classes.add(f.asset_class)
            buckets.add(f.bucket)
    # Herfindahl concentration (lower = more even).
    hhi = sum(w * w for w in weights.values())
    evenness = 1 - hhi  # 0..~1

    score = 0
    score += min(len(asset_classes), 4) * 15  # up to 60 for 4 asset classes
    score += min(len(buckets), 6) * 4  # up to 24 for category spread
    score += round(evenness * 16)  # up to 16 for even weighting
    score = max(0, min(100, score))

    if score >= 70:
        label = "Well diversified"
    elif score >= 45:
        label = "Moderately diversified"
    elif score >= 25:
        label = "Lightly diversified"
    else:
        label = "Concentrated"
    return score, label
