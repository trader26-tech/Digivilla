import { CalcConfig, Villa, fmtInr } from '../engine';

/**
 * The settings, turned into the figures screens quote in words ("3.6% a year",
 * "₹30,000 a month per ₹1 Cr", "first ₹1,25,000 a year free"…). Every screen
 * reads these — none of them is typed into a template.
 */
export interface Terms {
  swpMonthlyRate: number;     // 0.003
  swpYearPct: number;         // 3.6
  perCroreMonthly: number;    // ₹30,000
  sipIncomePct: number;       // 3.6
  cessPct: number;            // 4
  exempt: number;             // ₹1,25,000
  eqStPct: number; eqLtPct: number; eqLtMonths: number;
  goldLtPct: number; goldLtMonths: number;
  inflationPct: number;
  nriTdsPct: number;
  defaultSlab: number;
  rebalanceMonth: string;     // "1 January"
  rebalanceParts: string;     // "gold, large, mid and small cap"
  payFirst: string;           // "arbitrage"
  villasLine: string;         // "Conservative 30/70, Balanced 64/36, Aggressive 80/20"
}

const NAMES: Record<string, string> = { arbitrage: 'arbitrage', gold: 'gold', large: 'large cap', mid: 'mid cap', small: 'small cap' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
const r1 = (n: number) => Math.round(n * 10) / 10;

export function terms(cfg: CalcConfig): Terms {
  const w = cfg.withdrawals, t = cfg.tax;
  const pay = cfg.income.pay_first;
  return {
    swpMonthlyRate: w.lumpsum_monthly_rate,
    swpYearPct: r1(w.lumpsum_monthly_rate * 1200),
    perCroreMonthly: Math.round(1e7 * w.lumpsum_monthly_rate),
    sipIncomePct: r1(w.sip_yearly_rate * 100),
    cessPct: r1(t.cess * 100),
    exempt: t.equity_exempt,
    eqStPct: r1(t.equity_st_rate * 100), eqLtPct: r1(t.equity_lt_rate * 100), eqLtMonths: t.equity_lt_months,
    goldLtPct: r1(t.gold_lt_rate * 100), goldLtMonths: t.gold_lt_months,
    inflationPct: cfg.display.inflation_pct,
    nriTdsPct: cfg.fd.nri_tds_pct,
    defaultSlab: t.default_slab,
    rebalanceMonth: `1 ${MONTHS[cfg.rebalance.month % 12]}`,
    rebalanceParts: list(cfg.rebalance.parts.map((p) => NAMES[p] ?? p)),
    payFirst: list(pay.map((p) => NAMES[p] ?? p)),
    villasLine: cfg.villas.map((v) => `${v.name} ${mixLabel(v)}`).join(', '),
  };
}

/** "64/36" — growth / pay-first share (or the arbitrage share when nothing else is defined). */
export function mixLabel(v: Villa, payFirst: string[] = ['arbitrage']): string {
  const w = v.weights as Record<string, number>;
  const first = payFirst.reduce((s, k) => s + (w[k] ?? 0), 0);
  return `${Math.round((1 - first) * 100)}/${Math.round(first * 100)}`;
}

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const pct = (v: number | null, d = 1) => (v === null || !isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}%`);
export const rate = (v: number | null) => (v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`);
export { fmtInr };
