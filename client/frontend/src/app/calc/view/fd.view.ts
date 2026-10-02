import { Col3d } from '../bars-3d.component';
import { CalcConfig, PayoutResult, Villa, fmtInr, ymLabel } from '../engine';
import { bySleeve } from '../sleeves';
import { inr, pct } from './common';

const G = '#8fd65a', A = '#c9c6da', N = '#e4e7f5', R = '#e0796b';

export interface FdViewInput {
  r: PayoutResult;
  cfg: CalcConfig;
  villa: Villa;
  amount: number;
  fdRate: number;
  /** worst 12 months of this villa over all the history (risk) */
  worst: number | null;
  historyYear: string;
}

/** FD vs DigiVilla, ready to draw: the two columns, side-by-side rows, the walk-through. */
export function fdView(x: FdViewInput) {
  const { r, amount, fdRate } = x;
  const fdCol: Col3d = { art: 'bank', segs: [
    { label: 'Paid out', val: r.fdPaid, bg: 'linear-gradient(180deg,#6d7184,#585c6e)', side: '#454858', top: '#8b8fa3', k: '#d9dbe6', c: '#f2f2f6' },
    { label: 'Value', val: r.fdValue, bg: 'linear-gradient(180deg,#3a3d4a,#2b2e3a)', side: '#20222d', k: '#b2b6ca', c: '#e4e7f5' },
  ] };
  const dvCol: Col3d = dvColumn(r.swp, r.dvPaid, r.dvValue, 'Paid out');

  const row = (k: string, icon: string, a: string, as: string, ac: string, b: string, bs: string, bc: string, win: 'fd' | 'dv') =>
    ({ k, icon, a, as, ac, b, bs, bc, win, gauge: false, aDeg: 0, bDeg: 0 });
  const arbLine = r.arbEmptyMonth
    ? `ran out ${ymLabel(r.arbEmptyMonth)}; growth parts pay since`
    : `${Math.round(r.arbStartPct)}% → ${r.arbNowPct.toFixed(0)}% of the villa`;
  const vs = [
    row('Certainty', 'M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z', 'Certain', 'written in the contract', A, 'Not certain', 'the past isn’t a promise', N, 'fd'),
    { ...row('Risk', 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
        'Low', 'never falls', A, 'High',
        x.worst === null ? 'can fall' : `worst 12 months since ${x.historyYear}: ${pct(x.worst, 0)}`, R, 'fd'),
      gauge: true, aDeg: -72, bDeg: 72 },
    row('Real value', 'M3 12h4l3-8 4 16 3-8h4', fmtInr(r.fdReal), 'in today’s money', r.fdReal < amount ? R : N, fmtInr(r.dvReal), 'in today’s money', G, 'dv'),
    row('Compounding', 'M4 20 20 4M4 20v-6M4 20h6M20 4h-6M20 4v6', 'None', 'interest is paid out', N,
      (r.dvValue >= amount ? '+' : '') + fmtInr(r.dvValue - amount), `${fmtInr(amount)} is now ${fmtInr(r.dvValue)}`, G, 'dv'),
    r.swp
      ? row('Income', INCOME_ICON, inr(r.fdMonthly), 'a month after tax, never grows', N, inr(r.dvMonthly), 'a month, every month', G, 'dv')
      : row('Income', INCOME_ICON, inr(r.fdMonthly), 'a month after tax, never grows', N, 'None', 'SWP off — it all compounds', N, 'fd'),
    r.swp
      ? row('Paid from', DROP_ICON, 'Interest', 'principal untouched', N, 'Arbitrage', arbLine, G, 'dv')
      : row('Paid from', DROP_ICON, 'Interest', 'principal untouched', N, 'Nothing', 'turn SWP on for a monthly income', N, 'fd'),
  ];

  const explain = {
    mix: bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow }))),
    payments: r.months.length - 1,
    fdGross: amount * fdRate / 1200,
    taxTiny: r.dvPayoutTax < r.dvPaidGross * 0.01,
    gap: r.dvTotal - r.fdTotal,
  };
  return { fdCol, dvCol, vs, explain };
}

/** The DigiVilla column: Paid out + Value with SWP on; one compounding Value block with it off. */
export function dvColumn(swp: boolean, paid: number, value: number, paidLabel: string): Col3d {
  return { art: 'villa', pick: true, green: true, segs: swp ? [
    { label: paidLabel, val: paid, bg: 'linear-gradient(180deg,#b9e69a,#9ad471)', side: '#7fb85a', top: '#d3f0bd', k: '#2b4d18', c: '#10240a' },
    { label: 'Value', val: value, bg: 'linear-gradient(180deg,#4f9528,#2a5e18)', side: '#1f4a13', top: '#6cba36', k: '#d8f2c4', c: '#f2fbe9' },
  ] : [
    { label: 'Value', val: value, bg: 'linear-gradient(180deg,#9ad471 0%,#4f9528 55%,#2a5e18)', side: '#1f4a13', top: '#d3f0bd', k: '#d8f2c4', c: '#f2fbe9' },
  ] };
}

export const INCOME_ICON = 'M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 9.5 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5';
const DROP_ICON = 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z';
