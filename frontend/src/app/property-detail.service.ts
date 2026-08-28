import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** One month on the blended-basket growth/drawdown curve. */
export interface GrowthPoint {
  date: string;
  value: number;
  drawdown: number;
  move: number;
  driver?: string | null;
  driver_pct?: number | null;
}

export interface YearReturn {
  year: string;
  ret: number;
}

/** One horizon on the Monte Carlo fan. p5..p95 populated by the upgraded engine. */
export interface ProjPoint {
  year: number;
  p10: number;
  p50: number;
  p90: number;
  p5?: number;
  p25?: number;
  p75?: number;
  p95?: number;
}

export interface Projection {
  base: number;
  years: number;
  points: ProjPoint[];
  final_p10: number;
  final_p50: number;
  final_p90: number;
  // Monte Carlo provenance + "how probable" stats (upgraded engine).
  sims?: number;
  prob_gain?: number | null;
  prob_double?: number | null;
  expected_multiple?: number | null;
  sample_paths?: number[][];
}

/** Real, blended-NAV metrics for a basket — shape of POST /baskets/analyze. */
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
export class PropertyDetailService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  /** Real blended-NAV metrics + visual-evidence series + Monte Carlo for a mix. */
  analyze(items: { scheme_code: number; weight: number }[]): Observable<BasketMetrics> {
    return this.http.post<BasketMetrics>(`${this.base}/baskets/analyze`, {
      items,
      include_series: true,
    });
  }
}
