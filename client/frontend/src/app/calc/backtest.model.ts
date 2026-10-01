/**
 * Backtests on TODAY'S DigiVilla mix at REAL month-end NAVs — the arithmetic,
 * kept pure so it can be checked in isolation.
 *
 * Data: GET /calc/villa-funds → every fund in the admin's villa bucket (sleeve,
 * weight, Regular-plan month-end NAV), from Jul 2007 to the latest month. A fund
 * younger than the window is extended back with a similar fund's returns (listed
 * per fund as `proxy`).
 *
 * FD vs DigiVilla (simulatePayout): the amount buys real units of every fund at
 * the first month's NAV. Every month after, DigiVilla pays PAYOUT_RATE of the
 * amount (₹30,000 a month per ₹1 Cr, a fixed rupee amount) by SELLING ARBITRAGE
 * UNITS at that month's NAV — so the arbitrage share shrinks while the growth
 * funds are never touched. If the arbitrage runs out, the rest of the payout is
 * sold from the other funds in proportion to their value. No rebalancing.
 *
 * SIP (simulateSip): the same monthly amount buys real units of every fund by
 * weight, every month, at that month's NAV.
 *
 * Tax uses TODAY'S rules for every year (illustration): equity-oriented funds
 * (arbitrage, mid, small …) 20% if held ≤ 12 months, 12.5% after, the first
 * ₹1.25 L of long-term gains a financial year free; the gold fund-of-fund 12.5%
 * after 24 months, your slab before. 4% cess on all of it; surcharge ignored;
 * assumes no other equity gains that year. Only the GAIN inside units sold is
 * taxed — most of a payout is your own money coming back.
 */

export const PAYOUT_RATE = 0.003;              // a month — ₹30,000 per ₹1 Cr (3.6% a year)
export const CESS = 1.04;
export const EQ_STCG = 0.20, EQ_LTCG = 0.125, EQ_EXEMPT = 125_000;
export const GOLD_LTCG = 0.125;
export const EQ_LT_MONTHS = 12, GOLD_LT_MONTHS = 24;
export const INFLATION = 6;                    // % a year, for "in today's money"
export const NRI_TDS = 30;                     // % on NRO deposit interest

/** GET /calc/villa-funds */
export interface VillaFunds {
  ok: boolean;
  detail?: string;
  start: string;
  end: string;
  earliest: string;
  months: string[];
  funds: {
    sleeve: string;
    name: string;
    weight: number;                            // 0..1
    plan?: string;
    proxy: { name: string; until: string }[];
    nav: number[];
  }[];
}

export interface Fund { sleeve: string; name: string; weight: number; plan?: string; nav: number[]; proxy: { name: string; until: string }[]; }

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
      sleeve: x.sleeve, name: x.name, weight: x.weight, plan: x.plan,
      nav: x.nav.slice(from),
      proxy: x.proxy.filter((p) => p.until > months[0]),   // only stand-ins inside this window
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

/** The mix bought at the start and simply held — its worst 12-month fall in the window. */
export function worstYearPct(w: Window): number | null {
  const n = w.months.length;
  if (n < 13) return null;
  const idx = w.months.map((_, i) => w.funds.reduce((s, f) => s + f.weight * f.nav[i] / f.nav[0], 0));
  let worst = Infinity;
  for (let i = 0; i + 12 < n; i++) worst = Math.min(worst, idx[i + 12] / idx[i] - 1);
  return worst * 100;
}

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
  dvPayoutTax: number;          // tax on the gain inside units sold for payouts
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

  // ── DigiVilla: real units, payouts from arbitrage ──
  const funds = w.funds;
  const a = funds.findIndex((f) => f.sleeve === 'arbitrage');
  const units = funds.map((f) => (amount * f.weight) / f.nav[0]);
  const unitsStart = [...units];
  const W = amount * PAYOUT_RATE;
  let paidGross = 0, payoutTax = 0, arbEmptyMonth: string | null = null;
  let year = noGains(), curFy = fy(w.months[0]);
  const payFlows: number[] = [-amount];        // for the IRR: payouts in, tax out
  const yearly: PayoutYear[] = [];
  let paidThisYear = 0;

  const sell = (k: number, rupees: number, i: number) => {
    const u = rupees / funds[k].nav[i];
    units[k] -= u;
    addGain(year, funds[k].sleeve, u * (funds[k].nav[i] - funds[k].nav[0]), i);
  };

  for (let i = 1; i <= n; i++) {
    const f = fy(w.months[i]);
    if (f !== curFy) {                         // a financial year closed: its tax is due
      const tax = taxOnGains(year, fdTaxPct);
      payoutTax += tax; payFlows[i - 1] -= tax;
      year = noGains(); curFy = f;
    }
    let need = W;
    if (a >= 0) {
      const arbVal = units[a] * funds[a].nav[i];
      const take = Math.min(need, arbVal);
      if (take > 0) sell(a, take, i);
      need -= take;
    }
    if (need > 1e-6) {                         // arbitrage empty: the other funds, in proportion
      if (!arbEmptyMonth) arbEmptyMonth = w.months[i];
      const others = funds.map((x, k) => (k === a ? 0 : units[k] * x.nav[i]));
      const tot = others.reduce((s, v) => s + v, 0);
      if (tot > 0) others.forEach((v, k) => { if (v > 0) sell(k, Math.min(v, (need * v) / tot), i); });
    }
    paidGross += W; paidThisYear += W;
    payFlows.push(W);
    if (i % 12 === 0) {                        // a year since the start: snapshot it
      const value = funds.reduce((s2, x, k) => s2 + units[k] * x.nav[i], 0);
      const g: Gains = { ...year };
      funds.forEach((x, k) => addGain(g, x.sleeve, units[k] * (x.nav[i] - x.nav[0]), i));
      const curTax = taxOnGains(year, fdTaxPct);
      yearly.push({
        year: i / 12, month: w.months[i], value,
        valueAfterTax: value - Math.max(0, taxOnGains(g, fdTaxPct) - curTax),
        payout: paidThisYear, income: paidGross - payoutTax - curTax,
      });
      paidThisYear = 0;
    }
  }
  // the current (partial) financial year's tax on payouts so far
  const lastTax = taxOnGains(year, fdTaxPct);
  payoutTax += lastTax;

  const valueNow = funds.map((f, k) => units[k] * f.nav[n]);
  const dvValue = valueNow.reduce((s, v) => s + v, 0);
  const dvArbValue = a >= 0 ? valueNow[a] : 0;

  // tax if everything were sold today, on top of this year's payout gains
  const exit: Gains = { ...year };
  funds.forEach((f, k) => addGain(exit, f.sleeve, units[k] * (f.nav[n] - f.nav[0]), n));
  const dvExitTax = Math.max(0, taxOnGains(exit, fdTaxPct) - lastTax);

  payFlows[n] += dvValue - dvExitTax - lastTax;
  const deflate = Math.pow(1 + INFLATION / 100, n / 12);
  const dvPaid = paidGross - payoutTax;
  const fdTotal = amount + fdPaid, dvTotal = dvPaid + dvValue;

  return {
    months: w.months, years: n / 12,
    fdMonthly, fdPaid, fdValue: amount, fdTotal, fdTaxRate: t * 100,
    dvMonthly: W, dvPaidGross: paidGross, dvPayoutTax: payoutTax, dvPaid,
    dvArbValue, dvGrowthValue: dvValue - dvArbValue, dvValue, dvTotal, dvExitTax,
    dvIrr: irrPct(payFlows),
    arbStartPct: a >= 0 ? funds[a].weight * 100 : 0,
    arbNowPct: dvValue > 0 ? (dvArbValue / dvValue) * 100 : 0,
    arbEmptyMonth, yearly,
    funds: funds.map((f, k) => ({
      name: f.name, sleeve: f.sleeve, weight: f.weight,
      navStart: f.nav[0], navNow: f.nav[n],
      unitsStart: unitsStart[k], unitsNow: units[k],
      valueStart: amount * f.weight, valueNow: valueNow[k],
    })),
    fdReal: fdTotal / deflate, dvReal: dvTotal / deflate,
    worstYearPct: worstYearPct(w),
  };
}

// ─────────────────────────────────── SIP ───────────────────────────────────

export interface SipResult {
  months: string[];
  years: number;
  installments: number;
  invested: number;
  value: number;                // today, before tax on selling
  gain: number;
  exitTax: number;              // if you sold everything today
  valueAfterTax: number;
  xirr: number | null;
  funds: { name: string; sleeve: string; weight: number; invested: number; valueNow: number }[];
  path: { invested: number; value: number }[];   // month by month, for a chart
}

export function simulateSip(w: Window, monthly: number, slabPct = 30): SipResult {
  const n = w.months.length - 1;
  const funds = w.funds;
  const units = funds.map(() => 0);
  const tranches: { i: number; k: number; u: number }[] = [];
  const path: { invested: number; value: number }[] = [];
  let invested = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n) {                               // n instalments, valued a month after the last
      funds.forEach((f, k) => {
        const u = (monthly * f.weight) / f.nav[i];
        units[k] += u; tranches.push({ i, k, u });
      });
      invested += monthly;
    }
    path.push({ invested, value: funds.reduce((s, f, k) => s + units[k] * f.nav[i], 0) });
  }
  const value = path[n].value;
  const g = noGains();
  for (const t of tranches) addGain(g, funds[t.k].sleeve, t.u * (funds[t.k].nav[n] - funds[t.k].nav[t.i]), n - t.i);
  const exitTax = taxOnGains(g, slabPct);

  const flows = Array.from({ length: n + 1 }, (_, i) => (i < n ? -monthly : 0));
  flows[n] += value;

  return {
    months: w.months, years: n / 12, installments: n, invested, value, gain: value - invested,
    exitTax, valueAfterTax: value - exitTax, xirr: irrPct(flows),
    funds: funds.map((f, k) => ({ name: f.name, sleeve: f.sleeve, weight: f.weight, invested: invested * f.weight, valueNow: units[k] * f.nav[n] })),
    path,
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

// ──────────────────────── SIP with a yearly income (SWP) ────────────────────────

/**
 * A monthly SIP into today's mix, stepping up `stepPct` every 12 months, that
 * pays out INCOME_RATE of its value at the end of every year — sold from the
 * arbitrage fund first (then the rest, pro-rata). Every purchase is its own lot
 * and sales use first-in-first-out, so each sale's gain and holding period are
 * exact; tax is settled per financial year.
 */
export const INCOME_RATE = 0.036;            // a year, paid at each year end

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
  funds: { name: string; sleeve: string; weight: number; invested: number; valueNow: number }[];
}

interface Lot { u: number; nav: number; i: number; }

export function simulateSipIncome(w: Window, monthly: number, stepPct: number, slabPct = 30): SipIncomeResult {
  const n = w.months.length - 1;
  const funds = w.funds;
  const lots: Lot[][] = funds.map(() => []);
  const investedBy = funds.map(() => 0);
  const a = funds.findIndex((f) => f.sleeve === 'arbitrage');
  let year = noGains(), curFy = fy(w.months[0]);
  let invested = 0, incomeGross = 0, incomeTax = 0;
  const flows: number[] = Array.from({ length: n + 1 }, () => 0);
  const yearly: SipYear[] = [];

  const valueOf = (k: number, i: number) => lots[k].reduce((s, l) => s + l.u, 0) * funds[k].nav[i];
  const total = (i: number) => funds.reduce((s, _, k) => s + valueOf(k, i), 0);
  const sell = (k: number, rupees: number, i: number) => {
    let u = rupees / funds[k].nav[i];
    const q = lots[k];
    while (u > 1e-12 && q.length) {
      const l = q[0], take = Math.min(u, l.u);
      addGain(year, funds[k].sleeve, take * (funds[k].nav[i] - l.nav), i - l.i);
      l.u -= take; u -= take;
      if (l.u <= 1e-12) q.shift();
    }
  };
  /** tax if every remaining lot were sold at month i, on top of this year's gains so far */
  const exitTaxAt = (i: number) => {
    const g: Gains = { ...year };
    funds.forEach((f, k) => lots[k].forEach((l) => addGain(g, f.sleeve, l.u * (f.nav[i] - l.nav), i - l.i)));
    return Math.max(0, taxOnGains(g, slabPct) - taxOnGains(year, slabPct));
  };

  for (let i = 0; i <= n; i++) {
    const f = fy(w.months[i]);
    if (f !== curFy) {                       // a financial year closed: tax on what was sold in it
      const t = taxOnGains(year, slabPct);
      incomeTax += t; flows[i] -= t;
      year = noGains(); curFy = f;
    }
    if (i > 0 && i % 12 === 0) {             // year end: pay the income, then record the year
      const pay = total(i) * INCOME_RATE;
      let need = pay;
      if (a >= 0) { const take = Math.min(need, valueOf(a, i)); if (take > 0) sell(a, take, i); need -= take; }
      if (need > 1e-6) {
        const others = funds.map((_, k) => (k === a ? 0 : valueOf(k, i)));
        const tot = others.reduce((s, v) => s + v, 0);
        if (tot > 0) others.forEach((v, k) => { if (v > 0) sell(k, Math.min(v, (need * v) / tot), i); });
      }
      incomeGross += pay; flows[i] += pay;
      const value = total(i);
      yearly.push({ year: i / 12, month: w.months[i], invested, value, valueAfterTax: value - exitTaxAt(i), payout: pay });
    }
    if (i < n) {                             // this month's instalment, stepping up each year
      const amt = monthly * Math.pow(1 + stepPct / 100, Math.floor(i / 12));
      funds.forEach((fd, k) => {
        lots[k].push({ u: (amt * fd.weight) / fd.nav[i], nav: fd.nav[i], i });
        investedBy[k] += amt * fd.weight;
      });
      invested += amt; flows[i] -= amt;
    }
  }
  const lastTax = taxOnGains(year, slabPct);     // this financial year's payout tax, so far
  incomeTax += lastTax;
  const value = total(n);
  const exitTax = exitTaxAt(n);
  flows[n] += value - exitTax - lastTax;

  return {
    months: w.months, years: n / 12,
    firstMonthly: monthly, lastMonthly: monthly * Math.pow(1 + stepPct / 100, Math.max(0, Math.floor((n - 1) / 12))),
    invested, value, exitTax, valueAfterTax: value - exitTax,
    incomeGross, incomeTax, income: incomeGross - incomeTax,
    xirr: irrPct(flows), yearly,
    funds: funds.map((f, k) => ({ name: f.name, sleeve: f.sleeve, weight: f.weight, invested: investedBy[k], valueNow: valueOf(k, n) })),
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
 * DigiVilla: the SAME outlay into today's mix at real NAVs from the purchase
 *   month, paying INCOME_RATE a year as monthly rent out of arbitrage
 *   (simulatePayout). Total = rent paid (after tax) + value today.
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
