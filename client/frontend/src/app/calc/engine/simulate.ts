import { Book, Rebalance } from './book';
import { Fund, VillaFunds, Window, fy, irrPct, villaOf, windowFor, withVilla, worstYearPct } from './history';
import { TaxRules } from './tax';
import { CalcConfig } from './types';

/** Stamp duty on mutual-fund units (statutory, 0.005%). */
const MF_STAMP = 0.00005;

/** Is month i the yearly rebalance close (e.g. 31 Dec)? Never the start month. */
const isRebalance = (cfg: CalcConfig, months: string[], i: number) =>
  i > 0 && +months[i].slice(5, 7) === cfg.rebalance.month;

// ─────────────────────────── lumpsum: FD vs DigiVilla, Lumpsum, Flat ───────────────────────────

export interface PayoutInput {
  amount: number;
  fdRate: number;          // % a year (0 when there's no FD side)
  slabPct: number;         // income-tax slab (FD interest; gold short-term)
  swp: boolean;            // pay the monthly income?
}

export interface FundRow {
  name: string; sleeve: string; weight: number;
  navStart: number; navNow: number;
  unitsStart: number; unitsNow: number;
  valueStart: number; valueNow: number;
}

/** DigiVilla at one year end (Lumpsum's columns): after that year's payouts and rebalance. */
export interface PayoutYear { year: number; month: string; value: number; payout: number; income: number; }

export interface PayoutResult {
  months: string[];
  years: number;
  swp: boolean;
  fdMonthly: number; fdPaid: number; fdValue: number; fdTotal: number; fdTaxRate: number;
  dvMonthly: number;            // the payout a month, before its tax (0 with SWP off)
  dvPaidGross: number;
  dvPayoutTax: number;          // tax on the gains the payouts sold (taken from the payouts)
  dvPaid: number;               // received, after that tax
  dvRebalanceTax: number;       // tax on the yearly rebalances (paid from the proceeds)
  dvArbValue: number;           // the pay-first parts (arbitrage) still held
  dvGrowthValue: number;        // everything else
  dvValue: number;              // still invested today (no tax taken off)
  dvTotal: number;              // paid out (after tax) + still invested
  dvIrr: number | null;
  arbStartPct: number;
  arbNowPct: number;
  arbEmptyMonth: string | null; // when the pay-first parts ran out
  funds: FundRow[];
  yearly: PayoutYear[];
  rebalances: Rebalance[];
  fdReal: number; dvReal: number;
  worstYearPct: number | null;
}

export function simulatePayout(w: Window, inp: PayoutInput, cfg: CalcConfig): PayoutResult {
  const n = w.months.length - 1;
  const cess = 1 + cfg.tax.cess;
  const t = (inp.slabPct / 100) * cess;
  const { amount } = inp;

  // FD: interest paid monthly, taxed as income; the principal never moves
  const fdMonthly = (amount * inp.fdRate / 1200) * (1 - t);
  const fdPaid = fdMonthly * n;

  // DigiVilla
  const funds = w.funds;
  const book = new Book(funds, new TaxRules(cfg.tax, inp.slabPct), cfg);
  const first = book.firstPayers;
  funds.forEach((f, k) => book.buy(k, amount * f.weight, 0));
  const unitsStart = funds.map((_, k) => book.units(k));
  const W = inp.swp ? amount * cfg.withdrawals.lumpsum_monthly_rate : 0;
  let paidGross = 0, payTax = 0, rebalTax = 0, curFy = fy(w.months[0]), paidThisYear = 0;
  let arbEmptyMonth: string | null = null;
  const flows: number[] = [-amount];
  const yearly: PayoutYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 1; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) { book.closeYear(i); curFy = fy(w.months[i]); }
    let net = 0;
    if (W > 0) {
      if (book.pay(W, i) && !arbEmptyMonth) arbEmptyMonth = w.months[i];
      const tax = book.charge();
      paidGross += W; paidThisYear += W; payTax += tax; net = W - tax;
    }
    flows.push(net);
    if (isRebalance(cfg, w.months, i)) {
      const r = book.rebalance(i, w.months[i]);
      if (r) { rebalances.push(r); rebalTax += r.tax; }
    }
    if (i % 12 === 0) {
      yearly.push({ year: i / 12, month: w.months[i], value: book.total(i), payout: paidThisYear, income: paidGross - payTax });
      paidThisYear = 0;
    }
  }
  const valueNow = funds.map((_, k) => book.val(k, n));
  const dvValue = valueNow.reduce((s, v) => s + v, 0);
  const dvArbValue = first.reduce((s, k) => s + valueNow[k], 0);
  flows[n] += dvValue;
  const deflate = Math.pow(1 + cfg.display.inflation_pct / 100, n / 12);
  const dvPaid = paidGross - payTax;
  const fdTotal = amount + fdPaid, dvTotal = dvPaid + dvValue;

  return {
    months: w.months, years: n / 12, swp: inp.swp,
    fdMonthly, fdPaid, fdValue: amount, fdTotal, fdTaxRate: t * 100,
    dvMonthly: W, dvPaidGross: paidGross, dvPayoutTax: payTax, dvPaid, dvRebalanceTax: rebalTax,
    dvArbValue, dvGrowthValue: dvValue - dvArbValue, dvValue, dvTotal,
    dvIrr: irrPct(flows),
    arbStartPct: first.reduce((s, k) => s + funds[k].weight, 0) * 100,
    arbNowPct: dvValue > 0 ? (dvArbValue / dvValue) * 100 : 0,
    arbEmptyMonth, yearly, rebalances,
    funds: funds.map((f, k) => ({
      name: f.name, sleeve: f.sleeve, weight: f.weight,
      navStart: f.nav[0], navNow: f.nav[n],
      unitsStart: unitsStart[k], unitsNow: book.units(k),
      valueStart: amount * f.weight, valueNow: valueNow[k],
    })),
    fdReal: fdTotal / deflate, dvReal: dvTotal / deflate,
    worstYearPct: worstYearPct(w),
  };
}

/** Years behind the "% a yr" on each villa (Types of villas): the calculators' longest window. */
/** Fallback only — the window is the setting display.rate_years. */
export const VILLA_RATE_YEARS = 15;

/** A villa's growth a year over the last display.rate_years (a setting; 15 today), nothing
 *  withdrawn (SWP off, after the yearly rebalancing tax) — so it equals that-many-year, SWP-off calculator. */
export function villaRate(vf: VillaFunds, cfg: CalcConfig, key: string, years = rateYears(cfg)): number {
  const w = windowFor(withVilla(vf, villaOf(cfg, key)), years);
  const r = simulatePayout(w, { amount: 1e7, fdRate: 0, slabPct: cfg.tax.default_slab, swp: false }, cfg);
  return (Math.pow(r.dvValue / 1e7, 1 / r.years) - 1) * 100;
}
/** the years behind each villa's "% a yr" */
export const rateYears = (cfg: CalcConfig) => cfg.display?.rate_years ?? VILLA_RATE_YEARS;

// ─────────────────────────────── SIP (with a yearly income) ───────────────────────────────

export interface SipInput { monthly: number; stepPct: number; slabPct: number; swp: boolean; }

export interface SipYear { year: number; month: string; invested: number; value: number; payout: number; }

export interface SipIncomeResult {
  months: string[];
  years: number;
  swp: boolean;
  firstMonthly: number;
  lastMonthly: number;
  invested: number;
  value: number;
  incomeGross: number;
  incomeTax: number;
  income: number;
  rebalanceTax: number;
  xirr: number | null;
  yearly: SipYear[];
  rebalances: Rebalance[];
  funds: { name: string; sleeve: string; weight: number; invested: number; valueNow: number }[];
}

export function simulateSip(w: Window, inp: SipInput, cfg: CalcConfig): SipIncomeResult {
  const n = w.months.length - 1;
  const funds = w.funds;
  const book = new Book(funds, new TaxRules(cfg.tax, inp.slabPct), cfg);
  const investedBy = funds.map(() => 0);
  let curFy = fy(w.months[0]);
  let invested = 0, incomeGross = 0, incomeTax = 0, rebalTax = 0;
  const flows: number[] = Array.from({ length: n + 1 }, () => 0);
  const yearly: SipYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 0; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) { book.closeYear(i); curFy = fy(w.months[i]); }
    let pay = 0;
    if (inp.swp && i > 0 && i % 12 === 0) {
      pay = book.total(i) * cfg.withdrawals.sip_yearly_rate;
      book.pay(pay, i);
      const tax = book.charge();
      incomeGross += pay; incomeTax += tax; flows[i] += pay - tax;
    }
    if (isRebalance(cfg, w.months, i)) {
      const r = book.rebalance(i, w.months[i]);
      if (r) { rebalances.push(r); rebalTax += r.tax; }
    }
    if (i > 0 && i % 12 === 0) yearly.push({ year: i / 12, month: w.months[i], invested, value: book.total(i), payout: pay });
    if (i < n) {
      const amt = inp.monthly * Math.pow(1 + inp.stepPct / 100, Math.floor(i / 12));
      funds.forEach((f, k) => { book.buy(k, amt * f.weight, i); investedBy[k] += amt * f.weight; });
      invested += amt; flows[i] -= amt;
    }
  }
  const value = book.total(n);
  flows[n] += value;
  return {
    months: w.months, years: n / 12, swp: inp.swp,
    firstMonthly: inp.monthly,
    lastMonthly: inp.monthly * Math.pow(1 + inp.stepPct / 100, Math.max(0, Math.floor((n - 1) / 12))),
    invested, value,
    incomeGross, incomeTax, income: incomeGross - incomeTax, rebalanceTax: rebalTax,
    xirr: irrPct(flows), yearly, rebalances,
    funds: funds.map((f, k) => ({ name: f.name, sleeve: f.sleeve, weight: f.weight, invested: investedBy[k], valueNow: book.val(k, n) })),
  };
}

// ─────────────────────────────── Flat vs DigiVilla ───────────────────────────────

/**
 * "Had the same money gone into DigiVilla when you bought the flat."
 * Flat: all-in outlay = price × (1 + stamp + registration); rent = today's rent
 * shrunk back at the rent-rise rate, (12 − vacant) months a year, taxed at the
 * slab after the standard deduction (+ cess); minus upkeep. Total = today's
 * value + rent kept. DigiVilla: the SAME outlay from the purchase month
 * (simulatePayout). Every assumption is in cfg.flat.
 */
export interface FlatInput { price: number; value: number; rent: number; slabPct: number; swp: boolean; }

export interface FlatResult {
  months: string[];
  years: number;
  outlay: number;
  stamp: number;
  appPct: number;
  yieldPct: number;
  rentGross: number;
  rentTax: number;
  upkeep: number;
  rentKept: number;
  flTotal: number;
  flReal: number;
  flFriction: number;
  dv: PayoutResult;
  dvTotal: number;
  dvReal: number;
  dvFriction: number;
}

export function simulateFlat(w: Window, inp: FlatInput, cfg: CalcConfig): FlatResult {
  const F = cfg.flat;
  const Y = Math.max(1, Math.round((w.months.length - 1) / 12));
  const { price, value, rent, slabPct } = inp;
  const outlay = price * (1 + (F.stamp_pct + F.registration_pct) / 100);
  const app = Math.pow(value / price, 1 / Y) - 1;
  const taxRate = (slabPct / 100) * (1 - F.std_deduction) * (1 + cfg.tax.cess);
  let rentGross = 0, upkeep = 0;
  for (let t = 1; t <= Y; t++) {
    rentGross += (rent * (12 - F.vacant_months)) / Math.pow(1 + F.rent_rise_pct / 100, Y - t);
    upkeep += (F.upkeep_pct / 100) * price * Math.pow(1 + app, t);
  }
  const rentTax = rentGross * taxRate;
  const rentKept = rentGross - rentTax - upkeep;
  const flTotal = value + rentKept;
  const dv = simulatePayout(w, { amount: outlay, fdRate: 0, slabPct, swp: inp.swp }, cfg);
  const dvTotal = dv.dvPaid + dv.dvValue;
  const deflate = Math.pow(1 + cfg.display.inflation_pct / 100, Y);
  return {
    months: w.months, years: Y, outlay, stamp: outlay - price,
    appPct: app * 100, yieldPct: value > 0 ? (rent * 12 / value) * 100 : 0,
    rentGross, rentTax, upkeep, rentKept, flTotal, flReal: flTotal / deflate,
    flFriction: outlay - price + value * (F.sell_brokerage_pct / 100),
    dv, dvTotal, dvReal: dvTotal / deflate, dvFriction: outlay * MF_STAMP,
  };
}

export type { Fund, Rebalance };
