/**
 * The calculator SETTINGS — the one object every number comes from.
 * Served by GET /calc/config (client/backend/app/calc_config.py); edited in the
 * admin (Check the maths → Settings) or with scripts/calc_config.py. Nothing in
 * the engine, the view models or the screens hard-codes these values.
 */
export type SeriesKey = 'arbitrage' | 'gold' | 'large' | 'mid' | 'small';

export interface Villa {
  key: string;
  name: string;
  risk: 1 | 2 | 3;
  risk_name: string;
  /** share of the money in each series; adds up to 1 */
  weights: Partial<Record<SeriesKey, number>>;
}

export interface CalcConfig {
  version: number;
  updated_at?: string;
  updated_by?: string;
  note?: string;
  villas: Villa[];
  default_villa: string;
  /** the parts put back to their starting split once a year, at the close of `month` (12 = 31 Dec, i.e. 1 January) */
  rebalance: { parts: SeriesKey[]; month: number };
  /** the parts the SWP is sold from first; then the rest pro-rata */
  income: { pay_first: SeriesKey[] };
  withdrawals: {
    swp_default: boolean;
    /** lumpsum / FD / Flat: ₹ a month as a share of the amount put in (0.003 = ₹30,000 per ₹1 Cr) */
    lumpsum_monthly_rate: number;
    /** SIP: income a year as a share of the value, paid at each year end */
    sip_yearly_rate: number;
  };
  tax: {
    equity_st_rate: number;
    equity_lt_rate: number;
    equity_lt_months: number;
    equity_exempt: number;
    /** the series taxed like gold (slab short-term) */
    gold_parts: SeriesKey[];
    gold_lt_rate: number;
    gold_lt_months: number;
    cess: number;
    default_slab: number;
  };
  estate: {
    villa_cost: number;
    villa_income_monthly: number;
    plots: number;
    /** build stages in order; the last is at villa_cost */
    stages: { name: string; at: number }[];
  };
  /** the Flat calculator's assumptions */
  flat: {
    stamp_pct: number;
    registration_pct: number;
    sell_brokerage_pct: number;
    rent_rise_pct: number;
    upkeep_pct: number;          // % of the flat's value a year
    vacant_months: number;       // a year
    std_deduction: number;       // share of rent deducted before tax (0.3)
  };
  fd: { nri_tds_pct: number };
  /** inflation for "today's money"; rate_years = the window behind each villa's "% a yr" */
  display: { inflation_pct: number; rate_years: number };
}
