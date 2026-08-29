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
    # Grouping for the picker UI: "long" | "short" | "protect".
    category: str = "long"
    # Short-term goals are parked in liquid funds (stable, always accessible).
    liquid: bool = False


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


# --- Dashboard (fund research) --------------------------------------------
class DashboardFund(BaseModel):
    scheme_code: int
    isin: Optional[str] = None
    name: str
    fund_house: Optional[str] = None
    category: str
    bucket: str
    asset_class: str
    plan: str
    nav: Optional[float] = None
    nav_date: Optional[str] = None
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
    signals: List[str] = Field(default_factory=list)


class BucketGroup(BaseModel):
    bucket: str
    asset_class: str
    count: int
    funds: List[DashboardFund]


class DashboardOverview(BaseModel):
    total_funds: int
    total_buckets: int
    fund_houses: int
    updated_nav_date: Optional[str] = None
    top_overall: List[DashboardFund]
    top_gainers_1y: List[DashboardFund]
    lowest_risk: List[DashboardFund]
    buckets: List[BucketGroup]


class NavPoint(BaseModel):
    date: str
    nav: float


class NavWindow(BaseModel):
    """A single time-window view of a fund's NAV, for the 1Y/3Y/5Y toggle."""

    window: str  # 1y | 3y | 5y | max
    points: List[NavPoint]
    start_nav: Optional[float] = None
    end_nav: Optional[float] = None
    change_pct: Optional[float] = None  # total change over the window
    cagr_pct: Optional[float] = None  # annualized (None for <1y windows)
    high: Optional[float] = None
    low: Optional[float] = None


class NavHistoryResponse(BaseModel):
    scheme_code: int
    name: str
    current_nav: Optional[float] = None
    nav_date: Optional[str] = None
    windows: List[NavWindow]


class FundDetail(DashboardFund):
    nav_history: List[NavPoint] = Field(default_factory=list)
    peers: List[DashboardFund] = Field(default_factory=list)
    verdict: str = ""
    verdict_tone: str = "neutral"  # good | caution | neutral


# --- Goals (home monitoring) ----------------------------------------------
class GoalRecommendation(BaseModel):
    name: str
    asset_class: str
    weight: float
    monthly_amount: float


class GoalCreate(BaseModel):
    goal: str
    label: str
    target_amount: float
    horizon_years: float
    resolved_risk: str
    monthly_investment: float
    expected_return: float
    projected_p50: float
    projected_p10: float
    projected_p90: float
    success_rate: float
    recommendations: List[GoalRecommendation] = Field(default_factory=list)
    # Optional client id so browser-owned goals work without login.
    owner: Optional[str] = None


class Goal(GoalCreate):
    id: str
    created_at: str


class GoalProgress(BaseModel):
    """Where the goal should be *now* vs target, on a plan-based projection."""

    months_elapsed: int
    months_total: int
    invested_so_far: float
    on_track_value: float  # median-projection value expected by now
    target_amount: float
    progress_percent: float  # invested-vs-target, 0..100+
    on_track_percent: float  # on-track-value vs target, 0..100+
    status: str  # on_track | ahead | behind | new


# --- Baskets (research -> invest) -----------------------------------------
class BasketItem(BaseModel):
    scheme_code: int
    name: str
    fund_house: Optional[str] = None
    bucket: str
    asset_class: str
    rating: int = 3
    return_1y: Optional[float] = None
    return_3y: Optional[float] = None
    return_5y: Optional[float] = None
    weight: float  # 0..1 within the basket
    sleeve: Optional[str] = None  # which allocation sleeve this fills
    rationale: Optional[str] = None


class BasketSuggestRequest(BaseModel):
    risk: str  # conservative | balanced | aggressive
    horizon_years: Optional[float] = None
    monthly_amount: Optional[float] = None


class BasketSuggestResponse(BaseModel):
    risk: str
    allocation: dict  # asset_class -> weight
    items: List[BasketItem]
    note: str


class BasketCreate(BaseModel):
    name: str
    goal_id: Optional[str] = None
    goal_label: Optional[str] = None
    risk: Optional[str] = None
    monthly_amount: Optional[float] = None
    items: List[BasketItem]
    owner: Optional[str] = None


class Basket(BasketCreate):
    id: str
    created_at: str
    updated_at: str


# --- Auth -----------------------------------------------------------------
class SignupRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class PhoneAuthRequest(BaseModel):
    """Posted after the client completes Firebase phone-OTP verification."""
    name: str = ""
    phone: str
    id_token: str = ""  # Firebase ID token; verified server-side when Admin is set up


class AuthUser(BaseModel):
    owner: str
    email: str
    name: str = ""


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


# --- Bookings / Admin -----------------------------------------------------
class BookingCreate(BaseModel):
    """A consultation request a user submits when reserving a plot."""
    name: str
    phone: str
    property: str = "land"        # which tier they're reserving
    variant: str = ""             # conservative | balanced | aggressive
    plots: int = 1
    amount: float = 0
    slot: str                     # ISO-8601 datetime of the requested slot
    note: str = ""


class Booking(BookingCreate):
    id: str
    status: str = "requested"     # requested | confirmed | declined
    created_at: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str


class BookingStatusUpdate(BaseModel):
    status: str                   # confirmed | declined
