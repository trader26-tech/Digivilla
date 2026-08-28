from __future__ import annotations

from typing import Optional

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


# --- Dashboard (fund research) endpoints ----------------------------------
from fastapi import HTTPException, Query  # noqa: E402

from app import dashboard  # noqa: E402
from app.schemas import DashboardOverview, FundDetail  # noqa: E402


@app.get("/dashboard/overview", response_model=DashboardOverview)
def dashboard_overview() -> DashboardOverview:
    return dashboard.get_overview()


@app.get("/dashboard/funds", response_model=dict)
def dashboard_funds(
    bucket: Optional[str] = None,
    q: Optional[str] = None,
    asset_class: Optional[str] = None,
    sort: str = Query("score", pattern="^(score|return_1y|return_3y|return_5y|volatility|rating)$"),
    limit: int = Query(60, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> dict:
    total, funds = dashboard.list_funds(
        bucket=bucket, q=q, asset_class=asset_class, sort=sort, limit=limit, offset=offset
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [f.model_dump() for f in funds],
    }


@app.get("/dashboard/funds/{scheme_code}", response_model=FundDetail)
def dashboard_fund_detail(scheme_code: int) -> FundDetail:
    detail = dashboard.get_fund_detail(scheme_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Fund not found")
    return detail


@app.get("/dashboard/funds/{scheme_code}/nav")
def dashboard_fund_nav(scheme_code: int):
    """NAV history split into 1Y / 3Y / 5Y / max windows for the detail chart."""
    result = dashboard.get_nav_windows(scheme_code)
    if result is None:
        raise HTTPException(status_code=404, detail="NAV history unavailable")
    return result


# --- Goals (home monitoring) endpoints ------------------------------------
from app import goals as goals_svc  # noqa: E402
from app.schemas import Goal, GoalCreate, GoalProgress  # noqa: E402


@app.get("/goals", response_model=list)
def list_goals(owner: Optional[str] = None) -> list:
    result = []
    for g in goals_svc.list_goals(owner=owner):
        result.append(
            {**g.model_dump(), "progress": goals_svc.compute_progress(g).model_dump()}
        )
    return result


@app.post("/goals", response_model=Goal)
def create_goal(payload: GoalCreate) -> Goal:
    return goals_svc.create_goal(payload)


@app.delete("/goals/{goal_id}")
def delete_goal(goal_id: str, owner: Optional[str] = None) -> dict:
    ok = goals_svc.delete_goal(goal_id, owner=owner)
    if not ok:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"status": "deleted"}


# --- Baskets (research -> invest) endpoints -------------------------------
from app import baskets as baskets_svc  # noqa: E402
from app.schemas import (  # noqa: E402
    Basket,
    BasketCreate,
    BasketSuggestRequest,
    BasketSuggestResponse,
)


@app.post("/baskets/suggest", response_model=BasketSuggestResponse)
def suggest_basket(req: BasketSuggestRequest) -> BasketSuggestResponse:
    return baskets_svc.suggest(req.risk)


@app.get("/baskets/models")
def basket_models() -> list:
    """Three curated model baskets (conservative/balanced/aggressive)."""
    return baskets_svc.model_baskets()


@app.post("/baskets/derive", response_model=BasketSuggestResponse)
def derive_basket(prefs: dict) -> BasketSuggestResponse:
    """Derive a basket from hexagon preferences (returns/safety/stability/...)."""
    return baskets_svc.derive_from_prefs(prefs)


@app.post("/baskets/analyze")
def analyze_basket(payload: dict) -> dict:
    """Real blended-NAV metrics for a set of {scheme_code, weight} items.

    Pass include_series=true to also get the growth curve, drawdown curve and
    yearly returns (the visual evidence behind the numbers).
    """
    from app import basket_analytics

    items = payload.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="No items to analyze")
    include_series = bool(payload.get("include_series", False))
    invested = float(payload.get("invested", 0) or 0)
    monthly_rent = float(payload.get("monthly_rent", 0) or 0)
    return basket_analytics.analyze(
        items,
        include_series=include_series,
        invested=invested,
        monthly_rent=monthly_rent,
    ).model_dump()


@app.get("/dashboard/funds/{scheme_code}/info")
def fund_info(scheme_code: int) -> dict:
    """Beginner explainer + category-based composition for a fund."""
    from app import fund_info as fi

    fund = next((f for f in dashboard.all_funds() if f.scheme_code == scheme_code), None)
    if fund is None:
        raise HTTPException(status_code=404, detail="Fund not found")
    return fi.get_fund_info(fund.bucket).model_dump()


@app.get("/baskets", response_model=list)
def list_baskets(owner: Optional[str] = None, goal_id: Optional[str] = None) -> list:
    return [b.model_dump() for b in baskets_svc.list_baskets(owner=owner, goal_id=goal_id)]


@app.post("/baskets", response_model=Basket)
def create_basket(payload: BasketCreate) -> Basket:
    return baskets_svc.create_basket(payload)


@app.put("/baskets/{basket_id}", response_model=Basket)
def update_basket(basket_id: str, payload: BasketCreate) -> Basket:
    updated = baskets_svc.update_basket(basket_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Basket not found")
    return updated


@app.delete("/baskets/{basket_id}")
def delete_basket(basket_id: str, owner: Optional[str] = None) -> dict:
    baskets_svc.delete_basket(basket_id, owner=owner)
    return {"status": "deleted"}


# --- Auth endpoints -------------------------------------------------------
from fastapi import Header  # noqa: E402

from app import auth as auth_svc  # noqa: E402
from app import phone_auth as phone_svc  # noqa: E402
from app.schemas import AuthResponse, LoginRequest, PhoneAuthRequest, SignupRequest  # noqa: E402


@app.post("/auth/signup", response_model=AuthResponse)
def auth_signup(req: SignupRequest) -> dict:
    try:
        return auth_svc.signup(req.email, req.password, req.name or "")
    except auth_svc.AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/login", response_model=AuthResponse)
def auth_login(req: LoginRequest) -> dict:
    try:
        return auth_svc.login(req.email, req.password)
    except auth_svc.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/auth/phone", response_model=AuthResponse)
def auth_phone(req: PhoneAuthRequest) -> dict:
    """Sign in with a phone number after the client's Firebase OTP passes."""
    try:
        return phone_svc.login_with_phone(req.name or "", req.phone, req.id_token or "")
    except phone_svc.PhoneAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/auth/me")
def auth_me(authorization: Optional[str] = Header(default=None)) -> dict:
    token = authorization.replace("Bearer ", "", 1) if authorization else ""
    user = auth_svc.me(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# Serve the built Angular SPA (combined single-service deploy). Must be last
# so the catch-all route does not shadow the API endpoints above.
from app.static_spa import mount_spa  # noqa: E402

mount_spa(app)
