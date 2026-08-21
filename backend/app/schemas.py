from typing import List, Optional

from pydantic import BaseModel, Field


# --- Presets (drive the decision-tree UI) ---------------------------------
class GoalPreset(BaseModel):
    key: str
    label: str
    icon: str
    default_amount: int
    suggested_amounts: List[int]
    default_years: int
    default_risk: str
    blurb: str


# --- Plan request ---------------------------------------------------------
class PlanRequest(BaseModel):
    goal: str = Field(..., description="Goal key, e.g. 'retirement'")
    target_amount: float = Field(..., gt=0)
    horizon_years: float = Field(..., gt=0, le=60)
    risk: Optional[str] = Field(default=None, description="conservative | balanced | aggressive")


# --- Plan response --------------------------------------------------------
class FundRecommendation(BaseModel):
    code: str
    name: str
    category: str
    asset_class: str
    risk: str
    expected_return: float
    volatility: float
    expense_ratio: float
    weight: float
    monthly_amount: float
    rationale: str


class SimulationBands(BaseModel):
    months: List[int]
    p10: List[float]
    p50: List[float]
    p90: List[float]


class PlanResponse(BaseModel):
    goal: str
    target_amount: float
    horizon_years: float
    resolved_risk: str
    monthly_investment: float
    total_invested: float
    expected_return: float
    portfolio_volatility: float
    projected_p10: float
    projected_p50: float
    projected_p90: float
    projected_mean: float
    success_rate: float
    recommendations: List[FundRecommendation]
    bands: SimulationBands
    summary: str
