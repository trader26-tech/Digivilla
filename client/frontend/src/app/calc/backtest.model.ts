/**
 * Backtests of today's DigiVilla split on BENCHMARK INDICES — the arithmetic,
 * kept pure so it can be checked in isolation (the admin's "Check the maths"
 * page imports this exact file and compares it with an independent Python
 * version, admin/backend/app/audit.py).
 *
 * Data: GET /calc/villa-funds → one series per sleeve, month-end, from Apr 2010:
 *   arbitrage → NIFTY 50 Arbitrage Index · mid → NIFTY Midcap 150 TRI ·
 *   small → NIFTY Smallcap 250 TRI · gold → domestic gold (passive gold ETF).
 * No actively managed fund is used. Values are index levels (before any fund's
 * expense ratio); "units" below are units of the index.
 *
 * The book: every purchase is its own LOT (units, price, month). Sales take the
 * oldest lots first, so each sale's gain and holding period are exact.
 *
 * Rebalancing — every 1 January (valued at the 31 December month-end close),
 * whatever the start date: the ARBITRAGE part is left alone; the growth part
 * (mid cap, small cap, gold) is sold/bought back to the split it started with
 * (e.g. 24 : 24 : 16). Gains on what's sold are taxed like any other sale.
 *
 * FD / Lumpsum / Flat (simulatePayout): the amount buys every sleeve by weight.
 *   Each month DigiVilla pays PAYOUT_RATE of the amount (₹30,000 per ₹1 Cr) by
 *   selling ARBITRAGE; if that runs out, the growth part pays pro-rata.
 * SIP (simulateSipIncome): each month's amount (stepping up yearly) buys every
 *   sleeve by weight; 3.6% of the value is paid out at each year end (arbitrage
 *   first).
 *
 * Tax uses TODAY'S rules for every year (illustration): equity-oriented sleeves
 * 20% if held ≤ 12 months, 12.5% after, the first ₹1.25 L of long-term gains a
 * financial year free; gold 12.5% after 24 months, your slab before. 4% cess;
 * surcharge ignored; no other equity gains that year. Tax is settled per
 * financial year (April–March).
 */

export const PAYOUT_RATE = 0.003;              // a month — ₹30,000 per ₹1 Cr (3.6% a year)
export const CESS = 1.04;
export const EQ_STCG = 0.20, EQ_LTCG = 0.125, EQ_EXEMPT = 125_000;
export const GOLD_LTCG = 0.125;
export const EQ_LT_MONTHS = 12, GOLD_LT_MONTHS = 24;
export const INFLATION = 6;                    // % a year, for "in today's money"
export const NRI_TDS = 30;                     // % on NRO deposit interest
export const INCOME_RATE = 0.036;              // SIP: a year, paid at each year end

/** GET /calc/villa-funds */
export interface VillaFunds {
  ok: boolean;
  detail?: string;
  start: string;
  end: string;
  earliest: string;
  months: string[];
  basis?: string;                              // 'index'
  funds: {
    sleeve: string;
    name: string;
    source?: string;
    weight: number;                            // 0..1
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
  years: number;                               // actual length, in years
  clamped: boolean;                            // asked for more history than exists
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

const isGold = (sleeve: string) => sleeve === 'gold';
/** Indian financial year (April–March) a 'YYYY-MM' falls in. */
export function fy(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** Gains realised in one financial year, by how they're taxed. */
interface Gains { eqSt: number; eqLt: number; goldSt: number; goldLt: number; }
const noGains = (): Gains => ({ eqSt: 0, eqLt: 0, goldSt: 0, goldLt: 0 });

/** Tax on one financial year's realised gains (losses offset gains of the same kind). */
export function taxOnGains(g: Gains, slabPct: number): number {
  let st = g.eqSt, lt = g.eqLt;
  if (st < 0 && lt > 0) { lt = Math.max(0, lt + st); st = 0; }
  else if (lt < 0 && st > 0) { st = Math.max(0, st + lt); lt = 0; }
  const eq = Math.max(0, st) * EQ_STCG + Math.max(0, lt - EQ_EXEMPT) * EQ_LTCG;
  const gold = Math.max(0, g.goldSt) * (slabPct / 100) + Math.max(0, g.goldLt) * GOLD_LTCG;
  return (eq + gold) * CESS;
}

function addGain(g: Gains, sleeve: string, gain: number, heldMonths: number): void {
  if (isGold(sleeve)) {
    if (heldMonths > GOLD_LT_MONTHS) g.goldLt += gain; else g.goldSt += gain;
  } else if (heldMonths > EQ_LT_MONTHS) g.eqLt += gain;
  else g.eqSt += gain;
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

/** The split bought at the start and simply held — its worst 12-month fall in the window. */
export function worstYearPct(w: Window): number | null {
  const n = w.months.length;
  if (n < 13) return null;
  const idx = w.months.map((_, i) => w.funds.reduce((s, f) => s + f.weight * f.nav[i] / f.nav[0], 0));
  let worst = Infinity;
  for (let i = 0; i + 12 < n; i++) worst = Math.min(worst, idx[i + 12] / idx[i] - 1);
  return worst * 100;
}

// ──────────────────────────────── the book ────────────────────────────────

/** One 1-January rebalance: each sleeve's value before and after, and what moved. */
export interface Rebalance {
  month: string;                     // the 31-Dec close it was done at
  before: number[];                  // ₹ per fund, same order as w.funds
  after: number[];
  moved: number[];                   // ₹ bought (+) / sold (−) per fund
  tax: number;                       // tax this rebalance added to its year (est.)
}

interface Lot { u: number; nav: number; i: number; }

/** Lots per fund, FIFO sales with exact gains, per-financial-year tax. */
class Book {
  lots: Lot[][];
  year = noGains();
  constructor(public funds: Fund[], public slab: number) { this.lots = funds.map(() => []); }
  units(k: number): number { return this.lots[k].reduce((s, l) => s + l.u, 0); }
  val(k: number, i: number): number { return this.units(k) * this.funds[k].nav[i]; }
  total(i: number): number { return this.funds.reduce((s, _, k) => s + this.val(k, i), 0); }
  buy(k: number, rupees: number, i: number): void {
    if (rupees > 0) this.lots[k].push({ u: rupees / this.funds[k].nav[i], nav: this.funds[k].nav[i], i });
  }
  sell(k: number, rupees: number, i: number): void {
    let u = rupees / this.funds[k].nav[i];
    const q = this.lots[k];
    while (u > 1e-12 && q.length) {
      const l = q[0], take = Math.min(u, l.u);
      addGain(this.year, this.funds[k].sleeve, take * (this.funds[k].nav[i] - l.nav), i - l.i);
      l.u -= take; u -= take;
      if (l.u <= 1e-12) q.shift();
    }
  }
  /** Raise ₹need: arbitrage first, then the growth part pro-rata. Returns true if
   *  the arbitrage alone couldn't cover it. */
  pay(need: number, i: number, a: number): boolean {
    if (a >= 0) {
      const take = Math.min(need, this.val(a, i));
      if (take > 0) this.sell(a, take, i);
      need -= take;
    }
    if (need <= 1e-6) return false;
    const vals = this.funds.map((_, k) => (k === a ? 0 : this.val(k, i)));
    const tot = vals.reduce((s, v) => s + v, 0);
    if (tot > 0) vals.forEach((v, k) => { if (v > 0) this.sell(k, Math.min(v, (need * v) / tot), i); });
    return true;
  }
  /** 1 January: the growth part back to its starting split; arbitrage untouched. */
  rebalance(i: number, a: number, month: string): Rebalance | null {
    const growth = this.funds.map((_, k) => k).filter((k) => k !== a);
    const wsum = growth.reduce((s, k) => s + this.funds[k].weight, 0);
    const G = growth.reduce((s, k) => s + this.val(k, i), 0);
    if (!(G > 0) || !(wsum > 0)) return null;
    const before = this.funds.map((_, k) => this.val(k, i));
    const target = this.funds.map((f, k) => (k === a ? before[k] : (G * f.weight) / wsum));
    const moved = this.funds.map((_, k) => target[k] - before[k]);
    const taxBefore = taxOnGains(this.year, this.slab);
    growth.forEach((k) => { if (moved[k] < -0.005) this.sell(k, -moved[k], i); });
    growth.forEach((k) => { if (moved[k] > 0.005) this.buy(k, moved[k], i); });
    return { month, before, after: this.funds.map((_, k) => this.val(k, i)), moved,
             tax: Math.max(0, taxOnGains(this.year, this.slab) - taxBefore) };
  }
  /** Tax if every remaining lot were sold at month i, on top of this year's gains so far. */
  exitTax(i: number): number {
    const g: Gains = { ...this.year };
    this.funds.forEach((f, k) => this.lots[k].forEach((l) => addGain(g, f.sleeve, l.u * (f.nav[i] - l.nav), i - l.i)));
    return Math.max(0, taxOnGains(g, this.slab) - taxOnGains(this.year, this.slab));
  }
  /** Close a financial year: its tax, and a clean slate. */
  settle(): number { const t = taxOnGains(this.year, this.slab); this.year = noGains(); return t; }
}

/** 1 January rebalancing happens at each 31-December close (not the start month). */
const isRebalance = (months: string[], i: number) => i > 0 && months[i].endsWith('-12');

// ─────────────────────────────── FD vs DigiVilla ───────────────────────────────

export interface FundRow {
  name: string; sleeve: string; weight: number;
  navStart: number; navNow: number;
  unitsStart: number; unitsNow: number;
  valueStart: number; valueNow: number;
}

/** DigiVilla at one year end (Lumpsum's columns): after that year's payouts. */
export interface PayoutYear {
  year: number;
  month: string;
  value: number;            // still invested, before tax on selling
  valueAfterTax: number;    // if everything were sold then
  payout: number;           // paid out during that year, before its small tax
  income: number;           // paid out so far, after tax
}

export interface PayoutResult {
  months: string[];
  years: number;
  // FD
  fdMonthly: number;            // interest a month, after tax
  fdPaid: number;               // all interest received, after tax
  fdValue: number;              // the principal
  fdTotal: number;
  fdTaxRate: number;            // % incl. cess
  // DigiVilla
  dvMonthly: number;            // the payout a month, before its tax
  dvPaidGross: number;
  dvPayoutTax: number;          // tax on gains realised by payouts and rebalancing
  dvPaid: number;               // received, after that tax
  dvArbValue: number;           // arbitrage still held, today
  dvGrowthValue: number;        // everything else, today
  dvValue: number;              // still invested, before tax on selling
  dvTotal: number;              // paid out (after tax) + still invested
  dvExitTax: number;            // tax if you sold everything today
  dvIrr: number | null;         // a year, on what you'd have if you sold today
  arbStartPct: number;
  arbNowPct: number;
  arbEmptyMonth: string | null; // when the arbitrage ran out (growth funds paid since)
  funds: FundRow[];
  yearly: PayoutYear[];
  rebalances: Rebalance[];
  // in today's money
  fdReal: number;
  dvReal: number;
  worstYearPct: number | null;
}

export function simulatePayout(w: Window, amount: number, fdRate: number, fdTaxPct: number): PayoutResult {
  const n = w.months.length - 1;
  const t = (fdTaxPct / 100) * CESS;

  // ── FD: interest paid monthly, taxed as income; the principal never moves ──
  const fdMonthly = (amount * fdRate / 1200) * (1 - t);
  const fdPaid = fdMonthly * n;

  // ── DigiVilla ──
  const funds = w.funds;
  const a = funds.findIndex((f) => f.sleeve === 'arbitrage');
  const book = new Book(funds, fdTaxPct);
  funds.forEach((f, k) => book.buy(k, amount * f.weight, 0));
  const unitsStart = funds.map((_, k) => book.units(k));
  const W = amount * PAYOUT_RATE;
  let paidGross = 0, taxPaid = 0, curFy = fy(w.months[0]), paidThisYear = 0;
  let arbEmptyMonth: string | null = null;
  const flows: number[] = [-amount];
  const yearly: PayoutYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 1; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) {                 // a financial year closed: its tax is due
      const tax = book.settle();
      taxPaid += tax; flows[i - 1] -= tax;
      curFy = fy(w.months[i]);
    }
    if (book.pay(W, i, a) && !arbEmptyMonth) arbEmptyMonth = w.months[i];
    paidGross += W; paidThisYear += W;
    flows.push(W);
    if (isRebalance(w.months, i)) {
      const r = book.rebalance(i, a, w.months[i]);
      if (r) rebalances.push(r);
    }
    if (i % 12 === 0) {                              // a year since the start: snapshot it
      const value = book.total(i);
      yearly.push({ year: i / 12, month: w.months[i], value, valueAfterTax: value - book.exitTax(i),
                    payout: paidThisYear, income: paidGross - taxPaid - taxOnGains(book.year, fdTaxPct) });
      paidThisYear = 0;
    }
  }
  const lastTax = taxOnGains(book.year, fdTaxPct);   // the current (partial) year, so far
  const payoutTax = taxPaid + lastTax;
  const valueNow = funds.map((_, k) => book.val(k, n));
  const dvValue = valueNow.reduce((s, v) => s + v, 0);
  const dvArbValue = a >= 0 ? valueNow[a] : 0;
  const dvExitTax = book.exitTax(n);
  flows[n] += dvValue - dvExitTax - lastTax;
  const deflate = Math.pow(1 + INFLATION / 100, n / 12);
  const dvPaid = paidGross - payoutTax;
  const fdTotal = amount + fdPaid, dvTotal = dvPaid + dvValue;

  return {
    months: w.months, years: n / 12,
    fdMonthly, fdPaid, fdValue: amount, fdTotal, fdTaxRate: t * 100,
    dvMonthly: W, dvPaidGross: paidGross, dvPayoutTax: payoutTax, dvPaid,
    dvArbValue, dvGrowthValue: dvValue - dvArbValue, dvValue, dvTotal, dvExitTax,
    dvIrr: irrPct(flows),
    arbStartPct: a >= 0 ? funds[a].weight * 100 : 0,
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

// ──────────────────────── SIP with a yearly income (SWP) ────────────────────────

export interface SipYear {
  year: number;
  month: string;
  invested: number;         // put in so far
  value: number;            // after that year's payout, before tax on selling
  valueAfterTax: number;    // if everything were sold then
  payout: number;           // that year's income, before its tax
}

export interface SipIncomeResult {
  months: string[];
  years: number;
  firstMonthly: number;
  lastMonthly: number;
  invested: number;
  value: number;
  exitTax: number;
  valueAfterTax: number;    // the headline: what you'd keep selling today
  incomeGross: number;
  incomeTax: number;
  income: number;           // all the yearly payouts, after their tax
  xirr: number | null;
  yearly: SipYear[];
  rebalances: Rebalance[];
  funds: { name: string; sleeve: string; weight: number; invested: number; valueNow: number }[];
}

export function simulateSipIncome(w: Window, monthly: number, stepPct: number, slabPct = 30): SipIncomeResult {
  const n = w.months.length - 1;
  const funds = w.funds;
  const a = funds.findIndex((f) => f.sleeve === 'arbitrage');
  const book = new Book(funds, slabPct);
  const investedBy = funds.map(() => 0);
  let curFy = fy(w.months[0]);
  let invested = 0, incomeGross = 0, incomeTax = 0;
  const flows: number[] = Array.from({ length: n + 1 }, () => 0);
  const yearly: SipYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 0; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) {                 // a financial year closed: tax on what was sold in it
      const t = book.settle();
      incomeTax += t; flows[i] -= t;
      curFy = fy(w.months[i]);
    }
    if (i > 0 && i % 12 === 0) {                     // year end: pay the income
      const pay = book.total(i) * INCOME_RATE;
      book.pay(pay, i, a);
      incomeGross += pay; flows[i] += pay;
    }
    if (isRebalance(w.months, i)) {
      const r = book.rebalance(i, a, w.months[i]);
      if (r) rebalances.push(r);
    }
    if (i > 0 && i % 12 === 0) {
      const value = book.total(i);
      yearly.push({ year: i / 12, month: w.months[i], invested, value, valueAfterTax: value - book.exitTax(i),
                    payout: incomeGross - yearly.reduce((s, y) => s + y.payout, 0) });
    }
    if (i < n) {                                     // this month's instalment, stepping up each year
      const amt = monthly * Math.pow(1 + stepPct / 100, Math.floor(i / 12));
      funds.forEach((f, k) => { book.buy(k, amt * f.weight, i); investedBy[k] += amt * f.weight; });
      invested += amt; flows[i] -= amt;
    }
  }
  const lastTax = taxOnGains(book.year, slabPct);
  incomeTax += lastTax;
  const value = book.total(n);
  const exitTax = book.exitTax(n);
  flows[n] += value - exitTax - lastTax;

  return {
    months: w.months, years: n / 12,
    firstMonthly: monthly, lastMonthly: monthly * Math.pow(1 + stepPct / 100, Math.max(0, Math.floor((n - 1) / 12))),
    invested, value, exitTax, valueAfterTax: value - exitTax,
    incomeGross, incomeTax, income: incomeGross - incomeTax,
    xirr: irrPct(flows), yearly, rebalances,
    funds: funds.map((f, k) => ({ name: f.name, sleeve: f.sleeve, weight: f.weight, invested: investedBy[k], valueNow: book.val(k, n) })),
  };
}

// ─────────────────────────────── Flat vs DigiVilla ───────────────────────────────

/**
 * "Had the same money gone into DigiVilla when you bought the flat."
 * Flat: all-in outlay = price × (1 + stamp duty + 1% registration/brokerage).
 *   Rent: today's rent, assumed to have grown RENT_RISE a year to get there; 11
 *   months a year (one vacant); taxed at your slab after the 30% standard
 *   deduction (+ cess); minus upkeep (UPKEEP of the flat's value each year).
 *   Kept = rent after tax − upkeep. Total = today's value + rent kept.
 * DigiVilla: the SAME outlay, from the purchase month, paying 3.6% a year as
 *   monthly rent out of arbitrage (simulatePayout). Total = rent paid (after
 *   tax) + value today.
 */
export const FLAT_REG_PCT = 1, RENT_RISE = 5, UPKEEP = 0.004, VACANT_MONTHS = 1, STD_DEDUCTION = 0.3;

export interface FlatInputs { price: number; value: number; rent: number; stampPct: number; slabPct: number; }

export interface FlatResult {
  months: string[];
  years: number;
  outlay: number;
  stamp: number;            // stamp duty + registration paid
  appPct: number;           // the flat's price growth a year
  yieldPct: number;         // today's rent ÷ today's value
  rentGross: number;
  rentTax: number;
  upkeep: number;
  rentKept: number;
  flTotal: number;
  flReal: number;
  flFriction: number;       // stamp duty + registration + selling brokerage
  dv: PayoutResult;         // DigiVilla on the same outlay
  dvTotal: number;
  dvReal: number;
  dvFriction: number;       // 0.005% stamp duty on units
}

export function simulateFlat(w: Window, inp: FlatInputs): FlatResult {
  const Y = Math.max(1, Math.round((w.months.length - 1) / 12));
  const { price, value, rent, stampPct, slabPct } = inp;
  const outlay = price * (1 + (stampPct + FLAT_REG_PCT) / 100);
  const app = Math.pow(value / price, 1 / Y) - 1;
  const taxRate = (slabPct / 100) * (1 - STD_DEDUCTION) * CESS;
  let rentGross = 0, upkeep = 0;
  for (let t = 1; t <= Y; t++) {
    rentGross += (rent * (12 - VACANT_MONTHS)) / Math.pow(1 + RENT_RISE / 100, Y - t);
    upkeep += UPKEEP * price * Math.pow(1 + app, t);
  }
  const rentTax = rentGross * taxRate;
  const rentKept = rentGross - rentTax - upkeep;
  const flTotal = value + rentKept;
  const dv = simulatePayout(w, outlay, 0, slabPct);
  const dvTotal = dv.dvPaid + dv.dvValue;
  const deflate = Math.pow(1 + INFLATION / 100, Y);
  return {
    months: w.months, years: Y, outlay, stamp: outlay - price,
    appPct: app * 100, yieldPct: value > 0 ? (rent * 12 / value) * 100 : 0,
    rentGross, rentTax, upkeep, rentKept, flTotal, flReal: flTotal / deflate,
    flFriction: outlay - price + value * 0.015,
    dv, dvTotal, dvReal: dvTotal / deflate, dvFriction: outlay * 0.00005,
  };
}

/** ₹2.62 Cr / ₹36.4 L / ₹8,000 */
export function fmtInr(n: number): string {
  const s = n < 0 ? '−' : '';
  n = Math.abs(n);
  if (n >= 1e7) return s + '₹' + +(n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return s + '₹' + +(n / 1e5).toFixed(1) + ' L';
  return s + '₹' + Math.round(n).toLocaleString('en-IN');
}

export function ymLabel(ym: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = ym.split('-').map(Number);
  return `${M[m - 1]} ${y}`;
}
