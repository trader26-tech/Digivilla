"""Goal-planning engine.

Given a goal (target amount, horizon, risk appetite) this module:

  1. Chooses a risk-appropriate asset allocation based on the time horizon.
  2. Selects specific funds from the universe to fill that allocation, each
     with a plain-language rationale.
  3. Computes the blended expected return and volatility of that portfolio.
  4. Solves for the required monthly SIP to reach the target.
  5. Runs a Monte Carlo simulation of monthly contributions to produce a
     distribution of likely outcomes (p10 / p50 / p90 and success rate).

All math is deterministic Python (numpy). No external calls.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.funds import Fund

MONTHS_PER_YEAR = 12
SIMULATIONS = 5000


# --------------------------------------------------------------------------
# Allocation
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class AllocationSlice:
    asset_class: str
    weight: float


def resolve_risk(horizon_years: float, stated: str | None) -> str:
    """Blend the user's stated risk appetite with what the horizon allows.

    Short horizons cap risk regardless of appetite: you should not be heavily
    in equity for a goal two years away.
    """
    stated = (stated or "balanced").lower()
    if horizon_years < 3:
        return "conservative"
    if horizon_years < 6:
        return "conservative" if stated == "conservative" else "balanced"
    # 6+ years: honour appetite
    if stated in ("conservative", "balanced", "aggressive"):
        return stated
    return "balanced"


# Target asset-class mix per resolved risk level.
_ALLOCATION_TABLE: dict[str, list[AllocationSlice]] = {
    "conservative": [
        AllocationSlice("debt", 0.65),
        AllocationSlice("hybrid", 0.20),
        AllocationSlice("equity", 0.10),
        AllocationSlice("gold", 0.05),
    ],
    "balanced": [
        AllocationSlice("equity", 0.50),
        AllocationSlice("hybrid", 0.25),
        AllocationSlice("debt", 0.20),
        AllocationSlice("gold", 0.05),
    ],
    "aggressive": [
        AllocationSlice("equity", 0.75),
        AllocationSlice("hybrid", 0.15),
        AllocationSlice("debt", 0.05),
        AllocationSlice("gold", 0.05),
    ],
}


def target_allocation(risk: str) -> list[AllocationSlice]:
    return _ALLOCATION_TABLE.get(risk, _ALLOCATION_TABLE["balanced"])


# --------------------------------------------------------------------------
# Fund selection
# --------------------------------------------------------------------------
@dataclass
class Recommendation:
    fund: Fund
    weight: float
    rationale: str


def _pick_fund_for_class(asset_class: str, risk: str, universe: list[Fund]) -> Fund:
    """Pick the most suitable fund within an asset class for the risk level."""
    candidates = [f for f in universe if f.asset_class == asset_class]
    if not candidates:
        # Fallback: any fund, should not happen with a full universe.
        return universe[0]

    if asset_class == "equity":
        if risk == "aggressive":
            # Favour higher expected return.
            return max(candidates, key=lambda f: f.expected_return)
        if risk == "conservative":
            # Favour the steadiest equity (lowest volatility).
            return min(candidates, key=lambda f: f.volatility)
        # balanced: best return-per-unit-risk
        return max(candidates, key=lambda f: f.expected_return / f.volatility)

    if asset_class == "debt":
        # Longer/steadier debt for stability; pick lowest volatility with decent yield.
        return max(candidates, key=lambda f: f.expected_return / (f.volatility + 1e-6))

    # hybrid / gold: single best-in-class by return/risk
    return max(candidates, key=lambda f: f.expected_return / (f.volatility + 1e-6))


def _rationale(fund: Fund, asset_class: str, weight: float, risk: str) -> str:
    pct = round(weight * 100)
    role = {
        "equity": "drives long-term growth",
        "hybrid": "balances growth with downside protection",
        "debt": "stabilises the portfolio and preserves capital",
        "gold": "hedges inflation and diversifies away from equities",
    }.get(asset_class, "diversifies the portfolio")
    return (
        f"{pct}% here — {fund.name} ({fund.category}) {role}. "
        f"Chosen for a {risk} profile at ~{round(fund.expected_return * 100, 1)}% expected "
        f"return and ~{round(fund.volatility * 100)}% volatility. {fund.description}"
    )


def select_funds(risk: str, universe: list[Fund]) -> list[Recommendation]:
    recs: list[Recommendation] = []
    for slot in target_allocation(risk):
        fund = _pick_fund_for_class(slot.asset_class, risk, universe)
        recs.append(
            Recommendation(
                fund=fund,
                weight=slot.weight,
                rationale=_rationale(fund, slot.asset_class, slot.weight, risk),
            )
        )
    return recs


# --------------------------------------------------------------------------
# Portfolio stats
# --------------------------------------------------------------------------
def portfolio_stats(recs: list[Recommendation]) -> tuple[float, float]:
    """Return (expected_return, volatility) of the blended portfolio.

    Expected return is the weighted average. Volatility assumes moderate
    correlation (0.5) across sleeves — a middle ground between fully
    correlated and independent, which is realistic for a mixed portfolio.
    """
    exp = sum(r.weight * r.fund.expected_return for r in recs)

    corr = 0.5
    var = 0.0
    for i, ri in enumerate(recs):
        for j, rj in enumerate(recs):
            c = 1.0 if i == j else corr
            var += ri.weight * rj.weight * ri.fund.volatility * rj.fund.volatility * c
    vol = math.sqrt(max(var, 0.0))
    return exp, vol


# --------------------------------------------------------------------------
# Required SIP
# --------------------------------------------------------------------------
def required_monthly_sip(target: float, annual_return: float, years: float) -> float:
    """Solve the future value of an annuity for the monthly contribution.

    FV = P * [((1+r)^n - 1) / r] * (1+r)   (contributions at start of month)
    """
    n = int(round(years * MONTHS_PER_YEAR))
    if n <= 0:
        return target
    r = annual_return / MONTHS_PER_YEAR
    if abs(r) < 1e-9:
        return target / n
    factor = ((1 + r) ** n - 1) / r * (1 + r)
    return target / factor


def future_value_of_sip(monthly: float, annual_return: float, years: float) -> float:
    n = int(round(years * MONTHS_PER_YEAR))
    if n <= 0:
        return 0.0
    r = annual_return / MONTHS_PER_YEAR
    if abs(r) < 1e-9:
        return monthly * n
    return monthly * ((1 + r) ** n - 1) / r * (1 + r)


def median_growth_rate(annual_return: float, annual_vol: float) -> float:
    """Return the annualised *median* compound growth rate.

    Because portfolio values compound multiplicatively, the median path grows
    slower than the arithmetic mean by roughly half the variance (volatility
    drag). Sizing the SIP against this median makes the plan realistic: the
    typical (50/50) outcome meets the target, rather than only the lucky mean.
    """
    return annual_return - 0.5 * annual_vol**2


# --------------------------------------------------------------------------
# Monte Carlo
# --------------------------------------------------------------------------
@dataclass
class SimulationResult:
    p10: float
    p50: float
    p90: float
    mean: float
    success_rate: float
    percentile_paths: dict[str, list[float]]  # month-by-month p10/p50/p90 path
    invested: float


def monte_carlo(
    monthly: float,
    annual_return: float,
    annual_vol: float,
    years: float,
    target: float,
    simulations: int = SIMULATIONS,
    seed: int = 42,
) -> SimulationResult:
    """Simulate monthly SIP growth under lognormal monthly returns."""
    n = int(round(years * MONTHS_PER_YEAR))
    rng = np.random.default_rng(seed)

    mu_m = annual_return / MONTHS_PER_YEAR
    sig_m = annual_vol / math.sqrt(MONTHS_PER_YEAR)

    # Draw all monthly returns at once: shape (simulations, n)
    shocks = rng.normal(loc=mu_m, scale=sig_m, size=(simulations, n))
    growth = 1.0 + shocks

    # Track the balance path for percentile bands (sampled monthly).
    balances = np.zeros(simulations)
    # Store a coarse path (<= ~60 points) to keep the payload small.
    step = max(1, n // 60)
    path_months: list[int] = []
    path_p10: list[float] = []
    path_p50: list[float] = []
    path_p90: list[float] = []

    for m in range(n):
        balances = (balances + monthly) * growth[:, m]
        if m % step == 0 or m == n - 1:
            path_months.append(m + 1)
            path_p10.append(float(np.percentile(balances, 10)))
            path_p50.append(float(np.percentile(balances, 50)))
            path_p90.append(float(np.percentile(balances, 90)))

    invested = monthly * n
    p10, p50, p90 = (float(np.percentile(balances, q)) for q in (10, 50, 90))
    mean = float(balances.mean())
    success_rate = float((balances >= target).mean())

    return SimulationResult(
        p10=p10,
        p50=p50,
        p90=p90,
        mean=mean,
        success_rate=success_rate,
        invested=invested,
        percentile_paths={
            "months": path_months,
            "p10": path_p10,
            "p50": path_p50,
            "p90": path_p90,
        },
    )
