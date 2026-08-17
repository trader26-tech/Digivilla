"""Compute performance and risk metrics from a scheme's NAV history.

All metrics are derived legitimately from the free AMFI/mfapi NAV series — no
scraping of paywalled returns. Returns are percentages (e.g. 12.3 == 12.3%).
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from app.schemas.mutual_fund import ReturnMetrics

# (attr, days back) for point-to-point trailing returns.
_TRAILING = [
    ("return_1m", 30),
    ("return_3m", 91),
    ("return_6m", 182),
    ("return_1y", 365),
]
# (attr, years) for annualized (CAGR) returns.
_CAGR = [
    ("return_3y_cagr", 3),
    ("return_5y_cagr", 5),
]


def _nav_on_or_before(series: list[tuple[date, float]], target: date) -> float | None:
    """NAV at the latest date <= target (series sorted ascending by date)."""
    chosen = None
    for d, nav in series:
        if d <= target:
            chosen = nav
        else:
            break
    return chosen


def compute_metrics(series: list[tuple[date, float]]) -> ReturnMetrics:
    """`series` is (date, nav) sorted ascending. Missing windows -> None."""
    metrics = ReturnMetrics(history_points=len(series))
    if len(series) < 2:
        return metrics

    series = sorted(series, key=lambda x: x[0])
    inception_date, _ = series[0]
    latest_date, latest_nav = series[-1]
    metrics.inception_date = inception_date

    if latest_nav <= 0:
        return metrics

    # Trailing point-to-point returns.
    for attr, days in _TRAILING:
        past = _nav_on_or_before(series, latest_date - timedelta(days=days))
        if past and past > 0:
            setattr(metrics, attr, round((latest_nav / past - 1) * 100, 2))

    # Annualized (CAGR) returns over N years.
    for attr, years in _CAGR:
        past = _nav_on_or_before(series, latest_date - timedelta(days=365 * years))
        if past and past > 0:
            cagr = (latest_nav / past) ** (1 / years) - 1
            setattr(metrics, attr, round(cagr * 100, 2))

    # CAGR since inception.
    _, first_nav = series[0]
    span_years = (latest_date - inception_date).days / 365.25
    if first_nav > 0 and span_years >= 0.5:
        cagr = (latest_nav / first_nav) ** (1 / span_years) - 1
        metrics.cagr_since_inception = round(cagr * 100, 2)

    # Annualized volatility from daily log returns (last ~3y for relevance).
    recent = [nav for d, nav in series if d >= latest_date - timedelta(days=365 * 3)]
    if len(recent) > 20:
        rets = [
            math.log(recent[i] / recent[i - 1])
            for i in range(1, len(recent))
            if recent[i - 1] > 0 and recent[i] > 0
        ]
        if len(rets) > 1:
            mean = sum(rets) / len(rets)
            var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
            metrics.annualized_volatility = round(math.sqrt(var) * math.sqrt(252) * 100, 2)

    # Max drawdown over the full series.
    peak = series[0][1]
    max_dd = 0.0
    for _, nav in series:
        peak = max(peak, nav)
        if peak > 0:
            max_dd = min(max_dd, nav / peak - 1)
    metrics.max_drawdown = round(max_dd * 100, 2)

    return metrics
