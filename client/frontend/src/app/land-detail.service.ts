import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** One month on the blended-basket growth/drawdown curve. */
export interface GrowthPoint {
  date: string;        // 'YYYY-MM'
  value: number;       // basket value from a base investment
  drawdown: number;    // % below running peak (<= 0)
  move: number;        // this month's basket return %
  driver?: string | null;
  driver_pct?: number | null;
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

/** The real, blended-NAV metrics for a basket — the shape of POST /baskets/analyze. */
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

@Injectable({ providedIn: 'root' })
export class LandDetailService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  /** Real blended-NAV metrics + visual-evidence series for a set of funds. */
  analyze(items: { scheme_code: number; weight: number }[]): Observable<BasketMetrics> {
    return this.http.post<BasketMetrics>(`${this.base}/baskets/analyze`, {
      items,
      include_series: true,
    });
  }

  /** Villa growth-of-₹100 backtest: per-fund + blended lines + a summary of what
   *  `amount` invested at the start would be worth today. */
  villaBacktest(amount: number): Observable<VillaBacktest> {
    return this.http.get<VillaBacktest>(`${this.base}/villa/backtest?amount=${amount}`);
  }
}

/** One stacked band = a bucket's ₹ value over time. */
export interface VillaBtBand {
  key: string;          // equity | gold | arbitrage
  name: string;
  color: string;
  values: number[];     // ₹ value each month
}
export interface VillaBacktest {
  ok: boolean;
  detail?: string;
  dates: string[];
  bands: VillaBtBand[];  // bottom → top
  total: number[];
  blend_mult: number;
  worst_drawdown: number;
  summary: {
    invested: number;
    final_value: number;
    total_return_pct: number;
    monthly_income: number;
    income_paid_total: number;
    arb_zero_month: string | null;
    years: number;
    start: string;
    end: string;
  };
}
