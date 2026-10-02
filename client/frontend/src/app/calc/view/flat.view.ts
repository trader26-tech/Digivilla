import { Col3d } from '../bars-3d.component';
import { CalcConfig, FlatResult, fmtInr } from '../engine';
import { bySleeve } from '../sleeves';
import { Terms, inr } from './common';
import { INCOME_ICON, dvColumn } from './fd.view';

export interface FlatViewInput {
  r: FlatResult;
  cfg: CalcConfig;
  t: Terms;
  value: number;
  rent: number;
  worst: number | null;
  historyYear: string;
}

/** Flat vs DigiVilla, ready to draw: the two columns, side-by-side rows, the walk-through. */
export function flatView(x: FlatViewInput) {
  const { r, cfg, t } = x;
  const F = cfg.flat;
  const flCol: Col3d = { art: 'flat-building', segs: [
    { label: 'Rent kept', val: r.rentKept, bg: 'linear-gradient(180deg,#6d7184,#585c6e)', side: '#454858', top: '#8b8fa3', k: '#d9dbe6', c: '#f2f2f6' },
    { label: 'Worth today', val: x.value, bg: 'linear-gradient(180deg,#3a3d4a,#2b2e3a)', side: '#20222d', top: '#4a4e5c', k: '#b2b6ca', c: '#e4e7f5' },
  ] };
  const dvCol: Col3d = dvColumn(r.dv.swp, r.dv.dvPaid, r.dv.dvValue, 'Rent paid');

  const G = '#8fd65a', N = '#e4e7f5', A = '#c9c6da', R = '#e0796b', Y = '#e9c15c';
  const flWins = r.flTotal > r.dvTotal;
  const row = (k: string, icon: string, a: string, as: string, ac: string, b: string, bs: string, bc: string, win: 'fl' | 'dv', extra: object = {}) =>
    ({ k, icon, a, as, ac, b, bs, bc, win, gauge: false, aDeg: 0, bDeg: 0, ...extra });
  const vs = [
    row('Real value', 'M3 12h4l3-8 4 16 3-8h4', fmtInr(r.flReal), 'in today’s money', flWins ? A : N, fmtInr(r.dvReal), 'in today’s money', G, flWins ? 'fl' : 'dv'),
    row('Rent', INCOME_ICON,
      r.yieldPct.toFixed(1) + '%', `${inr(x.rent)} a month · ${F.vacant_months} month${F.vacant_months === 1 ? '' : 's'} empty`, N,
      r.dv.swp ? t.swpYearPct + '%' : 'None', r.dv.swp ? `${inr(r.dv.dvMonthly)} a month · every month` : 'SWP off — it all compounds', r.dv.swp ? G : N,
      !r.dv.swp || r.yieldPct > t.swpYearPct ? 'fl' : 'dv'),
    row('Risk', 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
      'Medium', 'one building, one city', Y, 'High',
      x.worst === null ? 'can fall' : `worst 12 months since ${x.historyYear}: ${x.worst < 0 ? '−' : '+'}${Math.abs(x.worst).toFixed(0)}%`, R, 'fl',
      { gauge: true, aDeg: 0, bDeg: 72 }),
    row('Liquidity', 'M12 2v6M12 22a7 7 0 0 0 7-7c0-4-7-9-7-9s-7 5-7 9a7 7 0 0 0 7 7z', 'Months', 'find a buyer, register', R, '3 days', 'redeem any business day', G, 'dv'),
    row('Entry & exit cost', 'M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 3H8M2 12h20',
      fmtInr(r.flFriction), `${F.stamp_pct}% stamp duty, ${F.registration_pct}% + ${F.sell_brokerage_pct}% brokerage`, R, fmtInr(r.dvFriction), '0.005% stamp duty on units', G, 'dv'),
    row('Effort', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', 'Yours', 'tenants, repairs, society', N, 'None', 'we look after it', G, 'dv'),
    row('You can live in it', 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', 'Yes', 'a home if you need one', A, 'No', 'it only pays you', N, 'fl'),
  ];
  const explain = {
    mix: bySleeve(r.dv.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow }))),
    rentNow: x.rent,
    rentThen: x.rent / Math.pow(1 + F.rent_rise_pct / 100, Math.max(0, r.years - 1)),
    gap: r.dvTotal - r.flTotal,
  };
  return { flCol, dvCol, vs, explain };
}
