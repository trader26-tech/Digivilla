/** World markets — time-frame maths on daily closes (pure; no Angular).
 *  A series is one index's daily closes in ONE currency (US$ or its own), day = days since 1970-01-01. */
import type { CpiSeries, WorldHistory } from '../admin.service';

export interface Daily { key: string; name: string; d: number[]; v: number[]; yield?: boolean; cpi?: boolean }
export type Ccy = 'usd' | 'local';

/** the closes in the chosen currency (days with no value dropped) */
export function daily(h: WorldHistory, ccy: Ccy): Daily {
  const d: number[] = [], v: number[] = [];
  const src = ccy === 'usd' ? h.u : h.v;
  for (let i = 0; i < h.d.length; i++) { const x = src[i]; if (x != null && x > 0) { d.push(h.d[i]); v.push(x); } }
  return { key: h.key, name: h.name, d, v, yield: h.kind === 'yield' };
}

/** index of the last close at or before `day` (−1 if none) */
export function idxAt(s: Daily, day: number): number {
  let lo = 0, hi = s.d.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.d[m] <= day) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
export const valueAt = (s: Daily, day: number) => { const i = idxAt(s, day); return i >= 0 ? s.v[i] : null; };

export const today = () => Math.floor(Date.now() / 86400000);
export const dayOf = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
export const isoOf = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);

/** where a time frame starts, counted back from `end` */
export function startOf(range: string, end: number, first: number): number {
  const y = new Date(end * 86400000).getUTCFullYear();
  switch (range) {
    case '1m': return end - 30;
    case '3m': return end - 91;
    case '6m': return end - 182;
    case 'ytd': return dayOf(`${y - 1}-12-31`);
    case '1y': return end - 365;
    case '3y': return end - 3 * 365;
    case '5y': return end - 5 * 365;
    case 'max': return first;
    default: { const n = /^(\d+)y$/.exec(range); return n ? end - Math.round(+n[1] * 365.25) : first; }   // 10y, 15y, 20y
  }
}

/** % change between two days (close at or before each), null if the series doesn't reach back */
export function change(s: Daily, from: number, to: number): number | null {
  if (!s.d.length || s.d[0] > from + 7) return null;     // started after the window opened
  const a = valueAt(s, from), b = valueAt(s, to);
  return a && b ? (b / a - 1) * 100 : null;
}
/** a YIELD's move between two days, in basis points (1 bp = 0.01 percentage point) */
export function bp(s: Daily, from: number, to: number): number | null {
  if (!s.d.length || s.d[0] > from + 7) return null;
  const a = valueAt(s, from), b = valueAt(s, to);
  return a !== null && b !== null ? (b - a) * 100 : null;
}
/** a yield over a window: where it started and ended, the move, its high and low */
export function yieldStats(s: Daily, from: number, to: number) {
  const i0 = Math.max(0, idxAt(s, from)), i1 = idxAt(s, to);
  if (i1 <= i0 || s.d[0] > from + 7) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = i0; i <= i1; i++) { hi = Math.max(hi, s.v[i]); lo = Math.min(lo, s.v[i]); }
  return { start: s.v[i0], end: s.v[i1], bp: (s.v[i1] - s.v[i0]) * 100, hi, lo };
}
export const cagr = (pct: number | null, days: number) =>
  pct === null || days < 300 ? null : (Math.pow(1 + pct / 100, 365.25 / days) - 1) * 100;

/** risk over a window: return, a-year rate, volatility (yearly), max drawdown, best / worst day */
export function stats(s: Daily, from: number, to: number) {
  const i0 = Math.max(0, idxAt(s, from)), i1 = idxAt(s, to);
  if (i1 <= i0 || s.d[0] > from + 7) return null;
  let peak = s.v[i0], dd = 0, sum = 0, sum2 = 0, n = 0, best = -Infinity, worst = Infinity;
  for (let i = i0 + 1; i <= i1; i++) {
    const r = Math.log(s.v[i] / s.v[i - 1]);
    sum += r; sum2 += r * r; n++;
    const p = (s.v[i] / s.v[i - 1] - 1) * 100;
    if (p > best) best = p; if (p < worst) worst = p;
    if (s.v[i] > peak) peak = s.v[i];
    dd = Math.min(dd, (s.v[i] / peak - 1) * 100);
  }
  const ret = (s.v[i1] / s.v[i0] - 1) * 100;
  const days = s.d[i1] - s.d[i0];
  const perYear = n / Math.max(1, days / 365.25);             // trading days a year, as this market trades
  const vol = n > 1 ? Math.sqrt(Math.max(0, (sum2 - (sum * sum) / n) / (n - 1)) * perYear) * 100 : null;
  return { ret, cagr: cagr(ret, days), vol, dd, best, worst, days };
}

/** each calendar year's return (last close of the year vs the last close of the year before) */
export function years(s: Daily, ys: number[], end: number): Record<number, number | null> {
  const out: Record<number, number | null> = {}, f = s.yield ? bp : change;
  for (const y of ys) out[y] = f(s, dayOf(`${y - 1}-12-31`), Math.min(end, dayOf(`${y}-12-31`)));
  return out;
}

/** the chart line: % change from the window's start, thinned to ≤ max points */
export function line(s: Daily, from: number, to: number, max = 700): [number, number][] {
  const i0 = Math.max(0, idxAt(s, from)), i1 = idxAt(s, to);
  if (i1 <= i0) return [];
  const base = s.v[i0], step = Math.max(1, Math.ceil((i1 - i0) / max)), out: [number, number][] = [];
  for (let i = i0; i <= i1; i += step) out.push([Math.max(s.d[i], from) * 86400, (s.v[i] / base - 1) * 100]);
  if (out[out.length - 1][0] !== s.d[i1] * 86400) out.push([s.d[i1] * 86400, (s.v[i1] / base - 1) * 100]);
  return out;
}

/** a monthly price index as a DAILY series (straight line between month starts, flat after the last) */
export function cpiDaily(c: CpiSeries, key: string, name: string): Daily {
  const d: number[] = [], v: number[] = [], end = Math.max(today(), c.d[c.d.length - 1]);
  for (let i = 0; i < c.d.length; i++) {
    const a = c.d[i], b = i + 1 < c.d.length ? c.d[i + 1] : end + 1, va = c.v[i], vb = i + 1 < c.v.length ? c.v[i + 1] : va;
    for (let day = a; day < b; day++) { d.push(day); v.push(va + ((vb - va) * (day - a)) / (b - a)); }
  }
  return { key, name, d, v, cpi: true };
}

/** REAL (after-inflation) closes: each close ÷ the price level that day — growth in today's money */
export function deflate(s: Daily, cpi: Daily): Daily {
  const d: number[] = [], v: number[] = [];
  for (let i = 0; i < s.d.length; i++) { const p = valueAt(cpi, s.d[i]); if (p) { d.push(s.d[i]); v.push(s.v[i] / p); } }
  return { ...s, d, v };
}

