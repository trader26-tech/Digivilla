export interface SchemeSummary {
  scheme_code: number;
  scheme_name: string;
  fund_house: string | null;
  scheme_category: string | null;
  plan: string | null;
  option: string | null;
  latest_nav: number | null;
  latest_nav_date: string | null;
}

export interface ReturnMetrics {
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_3y_cagr: number | null;
  return_5y_cagr: number | null;
  cagr_since_inception: number | null;
  annualized_volatility: number | null;
  max_drawdown: number | null;
  inception_date: string | null;
  history_points: number;
}

export interface SchemeDetail extends SchemeSummary {
  scheme_type: string | null;
  isin_growth: string | null;
  isin_div_reinvestment: string | null;
  history_synced_at: string | null;
  metrics: ReturnMetrics | null;
}

export interface SchemeListResponse {
  total: number;
  limit: number;
  offset: number;
  items: SchemeSummary[];
}

export interface NavPoint {
  date: string;
  nav: number;
}

export interface Stats {
  total_schemes: number;
  total_fund_houses: number;
  total_categories: number;
  latest_nav_date: string | null;
  nav_history_points: number;
}

export interface Facets {
  fund_houses: string[];
  categories: string[];
}

export interface FundQuery {
  q?: string;
  fund_house?: string;
  category?: string;
  plan?: string;
  option?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}
