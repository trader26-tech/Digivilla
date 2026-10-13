/** The three DigiVilla baskets as World-markets series (pure; no Angular).
 *  Each villa is replayed from the first day of /admin/market/performance (Apr 2010) on the
 *  calculators' benchmark indices — its mix from the settings, growth part back to its
 *  shares every 1 January, arbitrage untouched, pre-tax — exactly as the "Villas vs the
 *  market" chart does. That gives a NAV-like level in RUPEES; the US$ level divides by the
 *  rupee rate of the day (taken from the Nifty 50 history: its rupee close ÷ its dollar close). */
import type { MarketData, WorldHistory, WorldQuote } from '../admin.service';
import { replay } from './replay';

export const VILLA_PREFIX = 'villa_';
export const isVillaKey = (k: string) => k.startsWith(VILLA_PREFIX);

const dayNo = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);

/** ₹ per US$ on each day, from any INR market's history (v = ₹ close, u = US$ close) */
function inrPerUsd(fx: WorldHistory | null | undefined): (day: number) => number | null {
  if (!fx) return () => null;
  const d: number[] = [], r: number[] = [];
  fx.d.forEach((x, i) => { const u = fx.u[i]; if (u) { d.push(x); r.push(fx.v[i] / u); } });
  return (day) => {
    let lo = 0, hi = d.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= day) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 ? r[ans] : d.length ? r[0] : null;
  };
}

/** one WorldHistory per villa in the settings */
export function villaHistories(m: MarketData, fx: WorldHistory | null | undefined): WorldHistory[] {
  if (!m.days.length || !m.villas.length) return [];
  const rate = inrPerUsd(fx), e = m.days.length - 1;
  const days = m.days.map(dayNo);
  return m.villas.map((v) => {
    const lvl = replay(m, v.weights, m.rebalance, 0, e);
    return {
      key: VILLA_PREFIX + v.key, name: `${v.name} villa`, region: 'DigiVilla', kind: 'villa', currency: 'INR',
      d: days, v: lvl.map((x) => Math.round(x * 10000) / 10000),
      u: lvl.map((x, i) => { const r = rate(days[i]); return r ? Math.round((x / r) * 1e6) / 1e6 : null; }),
    } as WorldHistory;
  });
}

/** a quote-like row for the markets table: level, last day's move, a 30-day sparkline */
export function villaQuote(h: WorldHistory, mix: string): WorldQuote {
  const n = h.v.length - 1, p = Math.max(0, n - 1);
  const pct = (a: number | null | undefined, b: number | null | undefined) => (a && b ? (a / b - 1) * 100 : null);
  const yr = h.v.slice(Math.max(0, n - 250));
  return {
    key: h.key, symbol: '', name: h.name, region: 'DigiVilla', currency: 'INR', kind: 'villa', unit: mix,
    last: h.v[n], prev_close: h.v[p], change: h.v[n] - h.v[p], change_pct: pct(h.v[n], h.v[p]),
    usd_last: h.u[n] ?? null, usd_prev: h.u[p] ?? null, usd_change_pct: pct(h.u[n], h.u[p]), fx_pct: null,
    day_high: null, day_low: null, high_52w: Math.max(...yr), low_52w: Math.min(...yr),
    time: h.d[n] * 86400, spark: h.u.slice(Math.max(0, n - 30)).filter((x): x is number => x != null),
  } as unknown as WorldQuote;
}
