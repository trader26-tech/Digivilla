from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import engine
from app.config import get_settings
from app.funds import FUND_UNIVERSE, Fund
from app.presets import GOAL_PRESETS, PRESET_BY_KEY
from app.schemas import (
    FundRecommendation,
    PlanRequest,
    PlanResponse,
    SimulationBands,
)

settings = get_settings()

app = FastAPI(title="Goal Planner API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_fund_universe() -> list[Fund]:
    """Load funds from Supabase if the table exists, else use the code universe."""
    try:
        from app.supabase_client import get_supabase

        resp = get_supabase().table("funds").select("*").execute()
        rows = resp.data or []
        if rows:
            return [
                Fund(
                    code=r["code"],
                    name=r["name"],
                    category=r["category"],
                    asset_class=r["asset_class"],
                    risk=r["risk"],
                    expected_return=float(r["expected_return"]),
                    volatility=float(r["volatility"]),
                    expense_ratio=float(r["expense_ratio"]),
                    description=r.get("description", ""),
                )
                for r in rows
            ]
    except Exception:
        # No Supabase configured / table missing — fall back silently.
        pass
    return FUND_UNIVERSE


def _currency(v: float) -> str:
    """Format an amount in Indian ₹ with lakh/crore words."""
    if v >= 1e7:
        return f"₹{v / 1e7:.2f} Cr"
    if v >= 1e5:
        return f"₹{v / 1e5:.2f} L"
    return f"₹{v:,.0f}"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/presets", response_model=list)
def presets() -> list:
    return [p.model_dump() for p in GOAL_PRESETS]


@app.post("/plan", response_model=PlanResponse)
def create_plan(req: PlanRequest) -> PlanResponse:
    universe = load_fund_universe()

    stated_risk = req.risk
    if stated_risk is None:
        preset = PRESET_BY_KEY.get(req.goal)
        stated_risk = preset.default_risk if preset else "balanced"

    resolved = engine.resolve_risk(req.horizon_years, stated_risk)
    recs = engine.select_funds(resolved, universe)
    exp_return, vol = engine.portfolio_stats(recs)

    # Size the SIP against the *median* compound growth rate (accounts for
    # volatility drag) so the typical outcome meets the target, not just the
    # lucky mean. This lands the p50 simulation on/above the goal.
    planning_return = engine.median_growth_rate(exp_return, vol)
    monthly = engine.required_monthly_sip(req.target_amount, planning_return, req.horizon_years)
    sim = engine.monte_carlo(
        monthly=monthly,
        annual_return=exp_return,
        annual_vol=vol,
        years=req.horizon_years,
        target=req.target_amount,
    )

    fund_recs = [
        FundRecommendation(
            code=r.fund.code,
            name=r.fund.name,
            category=r.fund.category,
            asset_class=r.fund.asset_class,
            risk=r.fund.risk,
            expected_return=r.fund.expected_return,
            volatility=r.fund.volatility,
            expense_ratio=r.fund.expense_ratio,
            weight=r.weight,
            monthly_amount=round(monthly * r.weight),
            rationale=r.rationale,
        )
        for r in recs
    ]

    article = "an" if resolved[0] in "aeiou" else "a"
    summary = (
        f"To reach {_currency(req.target_amount)} in {req.horizon_years:g} years, "
        f"invest about {_currency(monthly)} per month via SIP into {article} {resolved} portfolio "
        f"(expected ~{exp_return * 100:.1f}% p.a.). Across 5,000 simulations the median "
        f"outcome is {_currency(sim.p50)} with a {sim.success_rate * 100:.0f}% chance of "
        f"meeting or beating your target."
    )

    return PlanResponse(
        goal=req.goal,
        target_amount=req.target_amount,
        horizon_years=req.horizon_years,
        resolved_risk=resolved,
        monthly_investment=round(monthly),
        total_invested=round(sim.invested),
        expected_return=exp_return,
        portfolio_volatility=vol,
        projected_p10=round(sim.p10),
        projected_p50=round(sim.p50),
        projected_p90=round(sim.p90),
        projected_mean=round(sim.mean),
        success_rate=sim.success_rate,
        recommendations=fund_recs,
        bands=SimulationBands(**sim.percentile_paths),
        summary=summary,
    )


# Serve the built Angular SPA (combined single-service deploy). Must be last
# so the catch-all route does not shadow the API endpoints above.
from app.static_spa import mount_spa  # noqa: E402

mount_spa(app)
