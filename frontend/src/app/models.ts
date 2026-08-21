export interface GoalPreset {
  key: string;
  label: string;
  icon: string;
  default_amount: number;
  suggested_amounts: number[];
  default_years: number;
  default_risk: string;
  blurb: string;
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
