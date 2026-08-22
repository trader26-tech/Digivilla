export interface GoalPreset {
  key: string;
  label: string;
  icon: string;
  default_amount: number;
  suggested_amounts: number[];
  default_years: number;
  default_risk: string;
  blurb: string;
  category?: string; // "long" | "short" | "protect"
  liquid?: boolean; // short-term goals parked in liquid funds
}

export interface PlanRequest {
  goal: string;
  target_amount: number;
  horizon_years: number;
  risk?: string;
}

export interface FundRecommendation {
  code: string;
  name: string;
  category: string;
  asset_class: string;
  risk: string;
  expected_return: number;
  volatility: number;
  expense_ratio: number;
  weight: number;
  monthly_amount: number;
  rationale: string;
}

export interface SimulationBands {
  months: number[];
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface PlanResponse {
  goal: string;
  target_amount: number;
  horizon_years: number;
  resolved_risk: string;
  monthly_investment: number;
  total_invested: number;
  expected_return: number;
  portfolio_volatility: number;
  projected_p10: number;
  projected_p50: number;
  projected_p90: number;
  projected_mean: number;
  success_rate: number;
  recommendations: FundRecommendation[];
  bands: SimulationBands;
  summary: string;
}

// --- Dashboard (fund research) --------------------------------------------
export interface DashboardFund {
  scheme_code: number;
  isin: string | null;
  name: string;
  fund_house: string | null;
  category: string;
  bucket: string;
  asset_class: string;
  plan: string;
  nav: number | null;
  nav_date: string | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  cagr_since_inception: number | null;
  volatility: number | null;
  max_drawdown: number | null;
  inception_date: string | null;
  history_points: number;
  score: number;
  rating: number;
  signals: string[];
}

export interface BucketGroup {
  bucket: string;
  asset_class: string;
  count: number;
  funds: DashboardFund[];
}

export interface DashboardOverview {
  total_funds: number;
  total_buckets: number;
  fund_houses: number;
  updated_nav_date: string | null;
  top_overall: DashboardFund[];
  top_gainers_1y: DashboardFund[];
  lowest_risk: DashboardFund[];
  buckets: BucketGroup[];
}

export interface NavPoint {
  date: string;
  nav: number;
}

export interface FundDetail extends DashboardFund {
  nav_history: NavPoint[];
  peers: DashboardFund[];
  verdict: string;
  verdict_tone: string;
}

export interface FundListResponse {
  total: number;
  limit: number;
  offset: number;
  items: DashboardFund[];
}

// --- Goals (home monitoring) ----------------------------------------------
export interface GoalRecommendation {
  name: string;
  asset_class: string;
  weight: number;
  monthly_amount: number;
}

export interface GoalCreate {
  goal: string;
  label: string;
  target_amount: number;
  horizon_years: number;
  resolved_risk: string;
  monthly_investment: number;
  expected_return: number;
  projected_p50: number;
  projected_p10: number;
  projected_p90: number;
  success_rate: number;
  recommendations: GoalRecommendation[];
  owner?: string;
}

export interface GoalProgress {
  months_elapsed: number;
  months_total: number;
  invested_so_far: number;
  on_track_value: number;
  target_amount: number;
  progress_percent: number;
  on_track_percent: number;
  status: string;
}

export interface Goal extends GoalCreate {
  id: string;
  created_at: string;
  progress: GoalProgress;
}

// --- NAV windows ----------------------------------------------------------
export interface NavWindow {
  window: string;
  points: NavPoint[];
  start_nav: number | null;
  end_nav: number | null;
  change_pct: number | null;
  cagr_pct: number | null;
  high: number | null;
  low: number | null;
}

export interface NavHistoryResponse {
  scheme_code: number;
  name: string;
  current_nav: number | null;
  nav_date: string | null;
  windows: NavWindow[];
}

// --- Baskets --------------------------------------------------------------
export interface BasketItem {
  scheme_code: number;
  name: string;
  fund_house: string | null;
  bucket: string;
  asset_class: string;
  rating: number;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  weight: number;
  sleeve?: string | null;
  rationale?: string | null;
}

export interface BasketSuggestResponse {
  risk: string;
  allocation: Record<string, number>;
  items: BasketItem[];
  note: string;
}

export interface BasketCreate {
  name: string;
  goal_id?: string | null;
  goal_label?: string | null;
  risk?: string | null;
  monthly_amount?: number | null;
  items: BasketItem[];
  owner?: string;
}

export interface Basket extends BasketCreate {
  id: string;
  created_at: string;
  updated_at: string;
}

// --- Fund info (beginner explainer + composition) -------------------------
export interface CompositionSlice {
  label: string;
  weight: number;
  kind: string; // equity | debt | cash | gold
}

export interface FundInfo {
  summary: string;
  invests_in: string;
  who_for: string;
  risk_label: string;
  composition: CompositionSlice[];
  cap_tilt?: CompositionSlice[] | null;
}

// --- Basket analytics -----------------------------------------------------
export interface GrowthPoint {
  date: string;
  value: number;
  drawdown: number;
  move: number;
  driver: string | null;
  driver_pct: number | null;
}
export interface YearReturn {
  year: string;
  ret: number;
}
export interface ProjPoint {
  year: number;
  p10: number;
  p50: number;
  p90: number;
}
export interface Projection {
  base: number;
  years: number;
  points: ProjPoint[];
  final_p10: number;
  final_p50: number;
  final_p90: number;
}
export interface BasketMetrics {
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  cagr: number | null;
  volatility: number | null;
  max_drawdown: number | null;
  expected_return: number | null;
  expected_low: number | null;
  expected_high: number | null;
  diversification: number;
  diversification_label: string;
  asset_mix: Record<string, number>;
  history_years: number;
  fund_count: number;
  base_investment: number;
  growth: GrowthPoint[];
  worst_drawdown_date: string | null;
  yearly_returns: YearReturn[];
  projection: Projection | null;
  min_investment: number;
}

export interface ModelBasket {
  key: string;
  name: string;
  description: string;
  risk: string;
  allocation: Record<string, number>;
  items: BasketItem[];
  note?: string;
}

export interface AuthUser {
  owner: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
