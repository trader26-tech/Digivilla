from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SchemeSummary(BaseModel):
    """Lightweight scheme row for list/explorer views."""

    model_config = ConfigDict(from_attributes=True)

    scheme_code: int
    scheme_name: str
    fund_house: str | None = None
    scheme_category: str | None = None
    plan: str | None = None
    option: str | None = None
    latest_nav: float | None = None
    latest_nav_date: date | None = None


class NavPoint(BaseModel):
    date: date
    nav: float


class ReturnMetrics(BaseModel):
    """Computed performance/risk metrics derived from NAV history."""

    return_1m: float | None = None
    return_3m: float | None = None
    return_6m: float | None = None
    return_1y: float | None = None
    return_3y_cagr: float | None = None
    return_5y_cagr: float | None = None
    cagr_since_inception: float | None = None
    annualized_volatility: float | None = None
    max_drawdown: float | None = None
    inception_date: date | None = None
    history_points: int = 0


class SchemeDetail(SchemeSummary):
    scheme_type: str | None = None
    isin_growth: str | None = None
    isin_div_reinvestment: str | None = None
    history_synced_at: datetime | None = None
    metrics: ReturnMetrics | None = None


class SchemeListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SchemeSummary]


class StatsResponse(BaseModel):
    total_schemes: int
    total_fund_houses: int
    total_categories: int
    latest_nav_date: date | None = None
    nav_history_points: int


class FacetResponse(BaseModel):
    fund_houses: list[str]
    categories: list[str]
