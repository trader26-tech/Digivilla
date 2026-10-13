/** Pure maths for the Villas vs the market chart (no Angular, so it can be tested on its own). */
import type { MarketData } from '../admin.service';

const PARTS_LABEL: Record<string, string> = { arbitrage: 'arbitrage', gold: 'gold', large: 'large', mid: 'mid', small: 'small' };

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function lowerBound<T>(a: T[], x: T): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
/** Fill a gap with the last value (and the first value backwards). */
export function carry(vals: (number | null)[]): number[] {
  const first = vals.find((v) => v !== null) ?? 1;
  let last = first as number;
  return vals.map((v) => (v === null ? last : (last = v)));
}

/** ₹100 in a villa from day s to day e (indices into d.days): pre-tax, growth part
 *  back to its starting shares at each `rebalance.month` close, arbitrage untouched. */
export function replay(d: MarketData, weights: Record<string, number>,
                       rb: { parts: string[]; month: number } | undefined, s: number, e: number): number[] {
  const parts = Object.keys(weights).filter((p) => weights[p] > 0 && d.series[p]);
  const px: Record<string, number[]> = {};
  for (const p of parts) px[p] = carry(d.series[p].values.slice(s, e + 1));
  const total = parts.reduce((a, p) => a + weights[p], 0) || 1;
  const units: Record<string, number> = {};
  for (const p of parts) units[p] = (100 * weights[p] / total) / px[p][0];
  const grow = parts.filter((p) => (rb?.parts ?? []).includes(p));
  const growW = grow.reduce((a, p) => a + weights[p], 0);
  const month = String(rb?.month ?? 12).padStart(2, '0');
  const out: number[] = [];
  const n = e - s;
  for (let i = 0; i <= n; i++) {
    let v = 0;
    for (const p of parts) v += units[p] * px[p][i];
    out.push(v);
    // the last close of the rebalance month (31 Dec close = the 1 Jan reset)
    if (i < n && growW > 0 && d.days[s + i].slice(5, 7) === month && d.days[s + i + 1].slice(5, 7) !== month) {
      let g = 0;
      for (const p of grow) g += units[p] * px[p][i];
      for (const p of grow) units[p] = (g * weights[p] / growW) / px[p][i];
    }
  }
  return out;
}

export function mixLabel(w: Record<string, number>, growth: string[]): string {
  const g = growth.reduce((a, p) => a + (w[p] || 0), 0);
  const arb = w['arbitrage'] || 0;
  const parts = growth.filter((p) => w[p] > 0).map((p) => PARTS_LABEL[p] ?? p).join(' · ');
  return `${Math.round(g * 100)}% growth (${parts}) · ${Math.round(arb * 100)}% arbitrage`;
}

export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(6));
  if (out.at(-1)! < hi) out.push(+(out.at(-1)! + step).toFixed(6));
  return out;
}
export function fmtNum(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString('en-IN') : v % 1 ? String(+v.toFixed(1)) : String(v);
}

/** Daily simple returns of a level series. */
export function dailyReturns(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) out.push(v[i] / v[i - 1] - 1);
  return out;
}
function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/** Annualised Sharpe: mean daily excess over the risk-free series ÷ its spread, × √252. */
export function sharpe(r: number[], rf: number[]): number | null {
  const ex = r.map((x, i) => x - (rf[i] ?? 0));
  const s = sd(ex);
  return s > 0 && ex.length >= 20 ? (mean(ex) / s) * Math.sqrt(252) : null;
}

/** β of r against the benchmark's returns b (same days). */
export function beta(r: number[], b: number[]): number | null {
  if (r.length < 20) return null;
  const mr = mean(r), mb = mean(b);
  let cov = 0, vb = 0;
  for (let i = 0; i < r.length; i++) { cov += (r[i] - mr) * (b[i] - mb); vb += (b[i] - mb) ** 2; }
  return vb > 0 ? cov / vb : null;
}

/** Annualised volatility of daily returns. */
export function vol(r: number[]): number { return sd(r) * Math.sqrt(252); }
