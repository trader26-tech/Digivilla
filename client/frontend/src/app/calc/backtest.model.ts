/**
 * Backtests of the three DigiVilla villas on BENCHMARK INDICES — the arithmetic,
 * kept pure so it can be checked in isolation (the admin's "Check the maths"
 * page imports this exact file and compares it with an independent Python
 * version, admin/backend/app/audit.py; research/portfolio_sim.py runs the same
 * rules on daily data).
 *
 * Data: GET /calc/villa-funds → one series per part, month-end, from Apr 2010:
 *   arbitrage → NIFTY 50 Arbitrage Index · large → NIFTY 50 TRI ·
 *   mid → NIFTY Midcap 150 TRI · small → NIFTY Smallcap 250 TRI ·
 *   gold → Gold BeES (Nippon India ETF Gold BeES NAV).
 * No actively managed fund is used. "Units" below are units of the index.
 *
 * The villas (PORTFOLIOS): a QUADRANT — gold / large / mid / small, 25% each —
 * plus ARBITRAGE: Conservative 30/70 · Balanced 64/36 · Aggressive 80/20.
 *
 * The book: every purchase is its own LOT (units, price, month). Sales take the
 * oldest lots first, so each sale's gain and holding period are exact.
 *
 * 1 January (valued at the 31 December month-end close), every year: the
 * quadrant goes back to 25% each; arbitrage is never touched. The tax on what
 * that sells is paid out of the proceeds — the quadrant resets to 25% each of
 * (its value − that tax).
 *
 * SWP (on by default): each month PAYOUT_RATE of the amount (₹30,000 per ₹1 Cr)
 * is sold — arbitrage first, then the quadrant pro-rata once arbitrage is empty.
 * The tax on that sale comes out of the payout: you receive gross − tax.
 * SIP: each month's amount (stepping up yearly) buys every part by weight; with
 * SWP on, 3.6% of the value is paid out at each year end the same way.
 *
 * Tax — today's rules for every year (illustration), per financial year (Apr–
 * Mar): equity (arbitrage / large / mid / small) 20% if held ≤ 12 months, 12.5%
 * after, the first ₹1.25 L of long-term gains a year free; Gold BeES (a listed
 * ETF) your slab if held ≤ 12 months, 12.5% after; 4% cess; surcharge ignored.
 * Each sale is charged the tax it ADDS to its year so far (so the exemption is
 * used in order); if a later loss lowers the year's bill, the difference comes
 * back into the quadrant at the year end. No tax is taken off the final value:
 * it is what's still invested.
 */

export const PAYOUT_RATE = 0.003;              // a month — ₹30,000 per ₹1 Cr (3.6% a year)
export const CESS = 1.04;
export const EQ_STCG = 0.20, EQ_LTCG = 0.125, EQ_EXEMPT = 125_000;
export const GOLD_LTCG = 0.125;
export const EQ_LT_MONTHS = 12, GOLD_LT_MONTHS = 12;     // Gold BeES is a listed ETF
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

// ─────────────────────────────── the three villas ───────────────────────────────

export type PfKey = 'conservative' | 'balanced' | 'aggressive';
export interface Portfolio { key: PfKey; name: string; quadrant: number; arbitrage: number; risk: 1 | 2 | 3; riskName: string; }
/** Single source of truth (mirrored in client/backend/app/index_data.py and admin audit.py). */
export const PORTFOLIOS: Portfolio[] = [
  { key: 'conservative', name: 'Conservative', quadrant: 0.30, arbitrage: 0.70, risk: 1, riskName: 'Low' },
  { key: 'balanced', name: 'Balanced', quadrant: 0.64, arbitrage: 0.36, risk: 2, riskName: 'Medium' },
  { key: 'aggressive', name: 'Aggressive', quadrant: 0.80, arbitrage: 0.20, risk: 3, riskName: 'High' },
];
export const QUADRANT = ['gold', 'large', 'mid', 'small'];
export const pfByKey = (k: PfKey): Portfolio => PORTFOLIOS.find((p) => p.key === k) ?? PORTFOLIOS[1];

/** The same history, weighted for one villa. */
export function withPortfolio(vf: VillaFunds, key: PfKey): VillaFunds {
  const p = pfByKey(key);
  return { ...vf, funds: vf.funds.map((f) => ({ ...f,
    weight: f.sleeve === 'arbitrage' ? p.arbitrage : QUADRANT.includes(f.sleeve) ? p.quadrant / QUADRANT.length : 0 })) };
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

/** One 1-January rebalance: each part's value before and after, and what moved. */
export interface Rebalance {
  month: string;                     // the 31-Dec close it was done at
  before: number[];                  // ₹ per fund, same order as w.funds
  after: number[];
  moved: number[];                   // ₹ bought (+) / sold (−) per fund
  tax: number;                       // tax paid out of the proceeds
}

interface Lot { u: number; nav: number; i: number; }

/** Lots per fund, FIFO sales with exact gains, tax charged sale by sale. */
class Book {
  lots: Lot[][];
  year = noGains();
  charged = 0;                       // tax charged so far this financial year
  constructor(public funds: Fund[], public slab: number) { this.lots = funds.map(() => []); }
  units(k: number): number { return this.lots[k].reduce((s, l) => s + l.u, 0); }
  val(k: number, i: number): number { return this.units(k) * this.funds[k].nav[i]; }
  total(i: number): number { return this.funds.reduce((s, _, k) => s + this.val(k, i), 0); }
  buy(k: number, rupees: number, i: number): void {
    if (rupees > 1e-9) this.lots[k].push({ u: rupees / this.funds[k].nav[i], nav: this.funds[k].nav[i], i });
  }
  /** Walk ₹rupees of fund k oldest-first, booking the gains into g (and taking the units if `take`). */
  private walk(k: number, rupees: number, i: number, g: Gains, take: boolean): void {
    let u = rupees / this.funds[k].nav[i];
    for (let j = 0; u > 1e-12 && j < this.lots[k].length; j++) {
      const l = this.lots[k][j], q = Math.min(u, l.u);
      addGain(g, this.funds[k].sleeve, q * (this.funds[k].nav[i] - l.nav), i - l.i);
      u -= q;
      if (take) l.u -= q;
    }
    if (take) this.lots[k] = this.lots[k].filter((l) => l.u > 1e-12);
  }
  sell(k: number, rupees: number, i: number): void { if (rupees > 1e-9) this.walk(k, rupees, i, this.year, true); }
  /** Tax these sales would ADD to the year so far (nothing is sold). */
  taxIf(sells: number[], i: number): number {
    const g: Gains = { ...this.year };
    sells.forEach((r, k) => { if (r > 1e-9) this.walk(k, r, i, g, false); });
    return Math.max(0, taxOnGains(g, this.slab) - this.charged);
  }
  /** After a sale: charge the tax it added to the year. */
  charge(): number {
    const inc = Math.max(0, taxOnGains(this.year, this.slab) - this.charged);
    this.charged += inc;
    return inc;
  }
  /** Financial year end: anything over-charged (a later loss) comes back. */
  closeYear(i: number, a: number): number {
    const credit = Math.max(0, this.charged - taxOnGains(this.year, this.slab));
    this.year = noGains();
    this.charged = 0;
    if (credit > 0) {
      const g = this.funds.map((_, k) => k).filter((k) => k !== a);
      const G = g.reduce((s, k) => s + this.val(k, i), 0);
      const W = g.reduce((s, k) => s + this.funds[k].weight, 0) || 1;
      g.forEach((k) => this.buy(k, credit * (G > 0 ? this.val(k, i) / G : this.funds[k].weight / W), i));
    }
    return credit;
  }
  /** Raise ₹need: arbitrage first, then the quadrant pro-rata. Returns true if
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
  /** 1 January: the quadrant back to its split of (value − tax); arbitrage untouched. */
  rebalance(i: number, a: number, month: string): Rebalance | null {
    const growth = this.funds.map((_, k) => k).filter((k) => k !== a && this.funds[k].weight > 0);
    const wsum = growth.reduce((s, k) => s + this.funds[k].weight, 0);
    const before = this.funds.map((_, k) => this.val(k, i));
    const G = growth.reduce((s, k) => s + before[k], 0);
    if (!(G > 0) || !(wsum > 0)) return null;
    const sellsFor = (tax: number) => this.funds.map((f, k) =>
      growth.includes(k) ? Math.max(0, before[k] - ((G - tax) * f.weight) / wsum) : 0);
    let tax = 0;
    for (let it = 0; it < 30; it++) {                  // the tax depends on the sells, the sells on the tax
      const t = this.taxIf(sellsFor(tax), i);
      if (Math.abs(t - tax) < 1e-6) break;
      tax = t;
    }
    const sells = sellsFor(tax);
    sells.forEach((r, k) => this.sell(k, r, i));
    const paid = this.charge();
    const cash = sells.reduce((s, r) => s + r, 0) - paid;
    const need = this.funds.map((f, k) => (growth.includes(k) ? Math.max(0, ((G - tax) * f.weight) / wsum - before[k]) : 0));
    const nTot = need.reduce((s, v) => s + v, 0);
    need.forEach((v, k) => { if (v > 0 && nTot > 0) this.buy(k, (cash * v) / nTot, i); });
    const after = this.funds.map((_, k) => this.val(k, i));
    return { month, before, after, moved: after.map((v, k) => v - before[k]), tax: paid };
  }
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

/** DigiVilla at one year end (Lumpsum's columns): after that year's payouts and 1 January. */
export interface PayoutYear {
  year: number;
  month: string;
  value: number;            // still invested
  payout: number;           // paid out during that year, before its tax
  income: number;           // paid out so far, after tax
}

export interface PayoutResult {
  months: string[];
  years: number;
  swp: boolean;
  // FD
  fdMonthly: number;            // interest a month, after tax
  fdPaid: number;               // all interest received, after tax
  fdValue: number;              // the principal
  fdTotal: number;
  fdTaxRate: number;            // % incl. cess
  // DigiVilla
  dvMonthly: number;            // the payout a month, before its tax (0 with SWP off)
  dvPaidGross: number;
  dvPayoutTax: number;          // tax on the gains the payouts sold (taken from the payouts)
  dvPaid: number;               // received, after that tax
  dvRebalanceTax: number;       // tax on the 1 January rebalances (paid from the proceeds)
  dvArbValue: number;           // arbitrage still held, today
  dvGrowthValue: number;        // the quadrant, today
  dvValue: number;              // still invested today
  dvTotal: number;              // paid out (after tax) + still invested
  dvIrr: number | null;         // a year
  arbStartPct: number;
  arbNowPct: number;
  arbEmptyMonth: string | null; // when the arbitrage ran out (the quadrant paid since)
  funds: FundRow[];
  yearly: PayoutYear[];
  rebalances: Rebalance[];
  // in today's money
  fdReal: number;
  dvReal: number;
  worstYearPct: number | null;
}

export function simulatePayout(w: Window, amount: number, fdRate: number, fdTaxPct: number, swp = true): PayoutResult {
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
  const W = swp ? amount * PAYOUT_RATE : 0;
  let paidGross = 0, payTax = 0, rebalTax = 0, curFy = fy(w.months[0]), paidThisYear = 0;
  let arbEmptyMonth: string | null = null;
  const flows: number[] = [-amount];
  const yearly: PayoutYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 1; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) { book.closeYear(i, a); curFy = fy(w.months[i]); }
    let net = 0;
    if (W > 0) {
      if (book.pay(W, i, a) && !arbEmptyMonth) arbEmptyMonth = w.months[i];
      const tax = book.charge();
      paidGross += W; paidThisYear += W; payTax += tax; net = W - tax;
    }
    flows.push(net);
    if (isRebalance(w.months, i)) {
      const r = book.rebalance(i, a, w.months[i]);
      if (r) { rebalances.push(r); rebalTax += r.tax; }
    }
    if (i % 12 === 0) {                              // a year since the start: snapshot it
      yearly.push({ year: i / 12, month: w.months[i], value: book.total(i), payout: paidThisYear, income: paidGross - payTax });
      paidThisYear = 0;
    }
  }
  const valueNow = funds.map((_, k) => book.val(k, n));
  const dvValue = valueNow.reduce((s, v) => s + v, 0);
  const dvArbValue = a >= 0 ? valueNow[a] : 0;
  flows[n] += dvValue;
  const deflate = Math.pow(1 + INFLATION / 100, n / 12);
  const dvPaid = paidGross - payTax;
  const fdTotal = amount + fdPaid, dvTotal = dvPaid + dvValue;

  return {
    months: w.months, years: n / 12, swp,
    fdMonthly, fdPaid, fdValue: amount, fdTotal, fdTaxRate: t * 100,
    dvMonthly: W, dvPaidGross: paidGross, dvPayoutTax: payTax, dvPaid, dvRebalanceTax: rebalTax,
    dvArbValue, dvGrowthValue: dvValue - dvArbValue, dvValue, dvTotal,
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

/** A villa's growth a year over the whole history, nothing withdrawn (after the
 *  1 January rebalancing tax) — the "% a yr" on each villa. */
export function villaRate(vf: VillaFunds, key: PfKey, slabPct = 30): number {
  const w = windowFor(withPortfolio(vf, key), 1000);
  const r = simulatePayout(w, 1e7, 0, slabPct, false);
  return (Math.pow(r.dvValue / 1e7, 1 / r.years) - 1) * 100;
}

// ──────────────────────── SIP with a yearly income (SWP) ────────────────────────

export interface SipYear {
  year: number;
  month: string;
  invested: number;         // put in so far
  value: number;            // after that year's payout and 1 January
  payout: number;           // that year's income, before its tax
}

export interface SipIncomeResult {
  months: string[];
  years: number;
  swp: boolean;
  firstMonthly: number;
  lastMonthly: number;
  invested: number;
  value: number;            // the headline: still invested today
  incomeGross: number;
  incomeTax: number;        // tax on the gains the income sold (taken from the income)
  income: number;           // all the yearly payouts, after their tax
  rebalanceTax: number;
  xirr: number | null;
  yearly: SipYear[];
  rebalances: Rebalance[];
  funds: { name: string; sleeve: string; weight: number; invested: number; valueNow: number }[];
}

export function simulateSipIncome(w: Window, monthly: number, stepPct: number, slabPct = 30, swp = true): SipIncomeResult {
  const n = w.months.length - 1;
  const funds = w.funds;
  const a = funds.findIndex((f) => f.sleeve === 'arbitrage');
  const book = new Book(funds, slabPct);
  const investedBy = funds.map(() => 0);
  let curFy = fy(w.months[0]);
  let invested = 0, incomeGross = 0, incomeTax = 0, rebalTax = 0;
  const flows: number[] = Array.from({ length: n + 1 }, () => 0);
  const yearly: SipYear[] = [];
  const rebalances: Rebalance[] = [];

  for (let i = 0; i <= n; i++) {
    if (fy(w.months[i]) !== curFy) { book.closeYear(i, a); curFy = fy(w.months[i]); }
    let pay = 0;
    if (swp && i > 0 && i % 12 === 0) {             // year end: pay the income
      pay = book.total(i) * INCOME_RATE;
      book.pay(pay, i, a);
      const tax = book.charge();
      incomeGross += pay; incomeTax += tax; flows[i] += pay - tax;
    }
    if (isRebalance(w.months, i)) {
      const r = book.rebalance(i, a, w.months[i]);
      if (r) { rebalances.push(r); rebalTax += r.tax; }
    }
    if (i > 0 && i % 12 === 0) yearly.push({ year: i / 12, month: w.months[i], invested, value: book.total(i), payout: pay });
    if (i < n) {                                     // this month's instalment, stepping up each year
      const amt = monthly * Math.pow(1 + stepPct / 100, Math.floor(i / 12));
      funds.forEach((f, k) => { book.buy(k, amt * f.weight, i); investedBy[k] += amt * f.weight; });
      invested += amt; flows[i] -= amt;
    }
  }
  const value = book.total(n);
  flows[n] += value;

  return {
    months: w.months, years: n / 12, swp,
    firstMonthly: monthly, lastMonthly: monthly * Math.pow(1 + stepPct / 100, Math.max(0, Math.floor((n - 1) / 12))),
    invested, value,
    incomeGross, incomeTax, income: incomeGross - incomeTax, rebalanceTax: rebalTax,
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
 *   monthly rent out of arbitrage with SWP on (simulatePayout). Total = rent
 *   paid (after tax) + value today.
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

export function simulateFlat(w: Window, inp: FlatInputs, swp = true): FlatResult {
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
  const dv = simulatePayout(w, outlay, 0, slabPct, swp);
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
