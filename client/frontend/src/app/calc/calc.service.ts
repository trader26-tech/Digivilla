import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';

/** One point on a chart line: `date` is 'YYYY-MM', `value` is ₹. */
export interface ChartPoint { date: string; value: number; }
/** One line on <app-growth-chart>. */
export interface ChartSeries {
  label: string;
  /** a plain colour (hex/rgb) — SVG attributes can't resolve CSS var() */
  color: string;
  points: ChartPoint[];
  dashed?: boolean;
  /** soft fill under the line */
  area?: boolean;
}

/** A fund in the user's basket, and the long-history stand-in(s) used for the
 *  months before it existed (only those overlapping the chosen window). */
export interface BasketFund {
  name: string;
  sleeve: string;
  weight: number;                          // percent
  proxy: { name: string; until: string }[]; // until = 'YYYY-MM' the fund itself begins
}

/** GET /me/calc/basket-growth — a lump sum in the user's own basket. */
export interface BasketGrowth {
  ok: boolean;
  detail?: string;
  amount: number;
  basket: 'yours' | 'standard';
  start_requested: string;
  start: string;
  start_clamped: boolean;
  earliest_available: string;
  end: string;
  years: number;
  series: ChartPoint[];
  final_value: number;
  cagr_pct: number | null;
  funds: BasketFund[];
}

/** Property transaction costs (shared with the flat calculator, from the
 *  DigiVilla deck): entry = stamp duty 7% + registration 4% + brokerage & legal
 *  3%; exit = selling brokerage 2%. The 1% TDS on a sale is NOT a cost — it's an
 *  advance payment of the seller's own tax, credited back when they file.
 *  Editable in each calculator. */
export const ENTRY_COST_PCT = 14;
export const EXIT_COST_PCT = 2; // selling brokerage; TDS is advance tax, not a cost

/** Compound annual growth rate, in percent. */
export function cagrPct(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end > 0) || !(years > 0)) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** Whole years (fractional) between a 'YYYY-MM' month and today. */
export function yearsSince(ym: string, today = new Date()): number {
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(y, m - 1, 15);
  return Math.max((today.getTime() - from.getTime()) / (365.25 * 86_400_000), 0);
}

/** Month keys 'YYYY-MM' from `from` to `to` inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Calculator data. Basket growth is fetched ONCE per start month for a ₹1L
 *  reference amount and scaled client-side (the path is linear in the amount),
 *  so every input change after the first is instant. */
@Injectable({ providedIn: 'root' })
export class CalcService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private cache = new Map<string, Observable<BasketGrowth | null>>();
  static readonly REF_AMOUNT = 100_000;

  /** Growth of ₹1L put into the user's own basket at `startYm` ('YYYY-MM').
   *  Emits null on failure (the UI shows a retry). */
  basketGrowthRef(startYm: string): Observable<BasketGrowth | null> {
    const hit = this.cache.get(startYm);
    if (hit) return hit;
    const t = this.auth.token();
    const req = this.http.get<BasketGrowth>(`${environment.apiUrl}/me/calc/basket-growth`, {
      params: { amount: CalcService.REF_AMOUNT, start: startYm },
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    }).pipe(
      map((r) => (r && r.ok ? r : null)),
      catchError(() => { this.cache.delete(startYm); return of(null); }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.cache.set(startYm, req);
    return req;
  }

  /** Scale a ₹1L reference result to `amount`. */
  static scale(g: BasketGrowth, amount: number): BasketGrowth {
    const k = amount / CalcService.REF_AMOUNT;
    return {
      ...g,
      amount,
      final_value: Math.round(g.final_value * k),
      series: g.series.map((p) => ({ date: p.date, value: Math.round(p.value * k) })),
    };
  }
}
