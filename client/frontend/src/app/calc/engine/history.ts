import { CalcConfig, Villa } from './types';

/** GET /calc/villa-funds: every benchmark series, month-end, on one window. */
export interface VillaFunds {
  ok: boolean;
  detail?: string;
  start: string;
  end: string;
  earliest: string;
  months: string[];
  basis?: string;
  funds: {
    sleeve: string;
    name: string;
    source?: string;
    weight: number;
    plan?: string;
    proxy: { name: string; until: string }[];
    nav: number[];
  }[];
}

export interface Fund { sleeve: string; name: string; source?: string; weight: number; plan?: string; nav: number[]; proxy: { name: string; until: string }[]; }

/** The last `years` of history (12 × years monthly steps), or all of it if shorter. */
export interface Window {
  months: string[];
  funds: Fund[];
  years: number;
  clamped: boolean;
}

export function windowFor(f: VillaFunds, years: number): Window {
  const want = 12 * years;
  const from = Math.max(0, f.months.length - 1 - want);
  const months = f.months.slice(from);
  return {
    months,
    funds: f.funds.map((x) => ({
      sleeve: x.sleeve, name: x.name, source: x.source, weight: x.weight, plan: x.plan,
      nav: x.nav.slice(from),
      proxy: (x.proxy || []).filter((p) => p.until > months[0]),
    })),
    years: (months.length - 1) / 12,
    clamped: f.months.length - 1 < want,
  };
}

/** A villa from the settings (falls back to the default villa). */
export function villaOf(cfg: CalcConfig, key?: string | null): Villa {
  return cfg.villas.find((v) => v.key === key) ?? cfg.villas.find((v) => v.key === cfg.default_villa) ?? cfg.villas[0];
}

/** The same history, weighted for one villa (series it doesn't hold get 0). */
export function withVilla(vf: VillaFunds, villa: Villa): VillaFunds {
  return { ...vf, funds: vf.funds.map((f) => ({ ...f, weight: (villa.weights as Record<string, number>)[f.sleeve] ?? 0 })) };
}

/** Indian financial year (April–March) a 'YYYY-MM' falls in. */
export function fy(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** The split bought at the start and simply held — its worst 12-month fall in the window. */
export function worstYearPct(w: Window): number | null {
  const n = w.months.length;
  if (n < 13) return null;
  const idx = w.months.map((_, i) => w.funds.reduce((s, f) => s + f.weight * f.nav[i] / f.nav[0], 0));
  let worst = Infinity;
  for (let i = 0; i + 12 < n; i++) worst = Math.min(worst, idx[i + 12] / idx[i] - 1);
  return worst * 100;
}

/** Annualised IRR of monthly cash flows (flows[0] is the investment, negative). */
export function irrPct(flows: number[]): number | null {
  const npv = (r: number) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
  let lo = -0.5, hi = 0.5;
  if (!(npv(lo) * npv(hi) < 0)) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}
