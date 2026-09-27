/**
 * Flat calculator — the arithmetic, kept pure so it can be checked in isolation.
 *
 * Question: "I bought a flat. What has it really returned, rent included — and
 * what would the same money have done in the DigiVilla bucket if it had paid me
 * the SAME in-hand rent every month?"
 *
 * The flat side
 *   outlay   = price × (1 + entry costs)          stamp duty, registration, brokerage
 *   rent_i   = today's rent, discounted back at the rent-growth rate (smooth, monthly)
 *   in-hand  = rent × (12 − vacant months)/12 − income tax − upkeep
 *   tax      = slab × (1 + 4% cess) × 70% of rent  (house property: 30% standard deduction)
 *   exit     = value today × (1 − selling cost)    TDS is an advance tax, not a cost
 *   value_i  = price → value today, geometric (we only know the two ends)
 *
 * The DigiVilla side
 *   The same outlay goes into the standard villa mix on the purchase month.
 *   Each month the flat's in-hand rent is paid out by SWP from the arbitrage
 *   vault; if the vault is empty the growth sleeves top it up pro-rata. Because
 *   both sides pay out identical income, the chart compares what's LEFT.
 *
 * Rent-matched vault
 *   The standard mix holds 36% in arbitrage to pay 0.3% of the ticket a month.
 *   A flat usually pays far less in hand, so its vault only needs
 *   36% × (flat in-hand ÷ standard SWP); the rest moves into the growth sleeves.
 *
 * Capital-gains tax is left out on both sides (it is owed only on sale, at
 * similar rates), and so is a home loan — this compares the assets, not the
 * financing.
 */

export const STANDARD_VAULT_PCT = 36;  // arbitrage share of the standard villa mix
export const STANDARD_SWP_MONTHLY = 0.003; // standard SWP: 0.3% of the ticket a month
const HOUSE_PROPERTY_TAXABLE = 0.7;    // 30% standard deduction on rent
const CESS = 1.04;

export interface FlatInputs {
  start: string;          // 'YYYY-MM' purchase month
  price: number;          // ₹ agreement value
  entryPct: number;       // % of price
  valueNow: number;       // ₹ what it would sell for today
  rentNow: number;        // ₹ a month, today
  rentGrowthPct: number;  // % a year
  vacancyMonths: number;  // a year
  taxSlabPct: number;     // 0 | 5 | 10 | 15 | 20 | 30
  upkeepNow: number;      // ₹ a month today: maintenance, repairs, property tax
  exitPct: number;        // % of value today
}

/** /calc/villa-funds — growth index per sleeve, 1.0 at months[0]. */
export interface VillaFunds {
  ok: boolean;
  detail?: string;
  start: string;
  end: string;
  earliest: string;
  months: string[];
  funds: { sleeve: string; name: string; weight: number; proxy: { name: string; until: string }[]; index: number[] }[];
  note?: string | null;
}

export interface FlatLedger {
  entryCosts: number;
  grossRent: number;
  vacancy: number;
  tax: number;
  upkeep: number;
  inHand: number;
  sellingCost: number;
}

export interface BucketRun {
  vaultPct: number;
  values: number[];      // portfolio value each month, after that month's SWP
  final: number;
  irrPct: number;
  vaultEmptyMonth: string | null;  // when the growth sleeves started topping up
}

export interface FlatResult {
  months: string[];
  years: number;
  outlay: number;
  firstInHand: number;             // month-1 in-hand rent
  lastInHand: number;
  priceCagrPct: number;            // price alone
  flatIrrPct: number;              // everything: costs, rent, tax, upkeep, sale
  flatValues: number[];            // flat's sale value (net of selling cost) each month
  flatFinal: number;
  ledger: FlatLedger;
  matchedVaultPct: number;
  matched: BucketRun;              // the vault chosen (matched, unless overridden)
  standard: BucketRun;             // 36% vault, same payouts
}

/** Month-by-month in-hand rent, month 1 … N (index 0 is the purchase month, no rent). */
function rentSchedule(inp: FlatInputs, n: number) {
  const g = Math.max(-0.5, inp.rentGrowthPct / 100);
  const occ = Math.min(12, Math.max(0, 12 - inp.vacancyMonths)) / 12;
  const taxRate = (inp.taxSlabPct / 100) * CESS * HOUSE_PROPERTY_TAXABLE;
  const inHand: number[] = [0];
  const led: FlatLedger = { entryCosts: 0, grossRent: 0, vacancy: 0, tax: 0, upkeep: 0, inHand: 0, sellingCost: 0 };
  for (let i = 1; i <= n; i++) {
    const back = Math.pow(1 + g, -(n - i) / 12);   // how far below today's level
    const gross = inp.rentNow * back;
    const collected = gross * occ;
    const tax = collected * taxRate;
    const upkeep = inp.upkeepNow * back;
    const net = collected - tax - upkeep;
    inHand.push(net);
    led.grossRent += gross; led.vacancy += gross - collected; led.tax += tax;
    led.upkeep += upkeep; led.inHand += net;
  }
  return { inHand, led };
}

/** Annualised IRR of monthly cash flows (flows[0] is the outlay, negative). */
export function monthlyIrrPct(flows: number[]): number {
  const npv = (r: number) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
  let lo = -0.99 / 12, hi = 1;           // monthly rate bounds
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

/** The DigiVilla bucket with `vaultPct` in arbitrage, paying `payout[i]` each month. */
export function runBucket(f: VillaFunds, outlay: number, vaultPct: number, payout: number[]): BucketRun {
  const a = Math.min(100, Math.max(0, vaultPct)) / 100;
  const arb = f.funds.find(x => x.sleeve === 'arbitrage')!;
  const growth = f.funds.filter(x => x.sleeve !== 'arbitrage');
  // units are in "index units": ₹ value = units × index
  let arbUnits = outlay * a;
  const gUnits = growth.map(() => (outlay * (1 - a)) / growth.length);
  const values: number[] = [outlay];
  const flows: number[] = [-outlay];
  let emptyAt: string | null = null;

  for (let i = 1; i < f.months.length; i++) {
    let need = payout[i];
    const arbVal = arbUnits * arb.index[i];
    if (need <= arbVal || need < 0) {
      arbUnits -= need / arb.index[i];      // a negative payout (flat costs money) tops the vault up
      need = 0;
    } else {
      arbUnits = 0;
      need -= arbVal;
      if (!emptyAt) emptyAt = f.months[i];
      const gVal = growth.reduce((s, x, k) => s + gUnits[k] * x.index[i], 0);
      const take = gVal > 0 ? Math.min(1, need / gVal) : 0;
      for (let k = 0; k < gUnits.length; k++) gUnits[k] *= 1 - take;
    }
    const v = arbUnits * arb.index[i] + growth.reduce((s, x, k) => s + gUnits[k] * x.index[i], 0);
    values.push(v);
    flows.push(payout[i]);
  }
  const final = values[values.length - 1];
  flows[flows.length - 1] += final;
  return { vaultPct: a * 100, values, final, irrPct: monthlyIrrPct(flows), vaultEmptyMonth: emptyAt };
}

/** The rent-matched arbitrage share: the standard 36% scaled to the flat's in-hand rent. */
export function matchedVault(firstInHand: number, outlay: number): number {
  const standardSwp = outlay * STANDARD_SWP_MONTHLY;
  if (standardSwp <= 0) return STANDARD_VAULT_PCT;
  const pct = STANDARD_VAULT_PCT * Math.max(0, firstInHand) / standardSwp;
  return Math.min(100, Math.round(pct * 2) / 2);   // half-point steps
}

export function computeFlat(inp: FlatInputs, f: VillaFunds, vaultOverridePct?: number | null): FlatResult {
  const months = f.months;
  const n = months.length - 1;
  const years = n / 12;
  const outlay = inp.price * (1 + inp.entryPct / 100);
  const { inHand, led } = rentSchedule(inp, n);

  const exitK = 1 - inp.exitPct / 100;
  const ratio = inp.price > 0 ? inp.valueNow / inp.price : 1;
  const flatValues = months.map((_, i) => inp.price * Math.pow(ratio, n ? i / n : 1) * exitK);
  const flatFinal = flatValues[n];
  led.entryCosts = outlay - inp.price;
  led.sellingCost = inp.valueNow - flatFinal;

  const flatFlows = inHand.map((x, i) => (i === 0 ? -outlay : x));
  flatFlows[n] += flatFinal;

  const matchedVaultPct = matchedVault(inHand[1] ?? 0, outlay);
  const vault = vaultOverridePct ?? matchedVaultPct;

  return {
    months, years, outlay,
    firstInHand: inHand[1] ?? 0,
    lastInHand: inHand[n] ?? 0,
    priceCagrPct: (Math.pow(ratio, 1 / Math.max(years, 1 / 12)) - 1) * 100,
    flatIrrPct: monthlyIrrPct(flatFlows),
    flatValues, flatFinal, ledger: led,
    matchedVaultPct,
    matched: runBucket(f, outlay, vault, inHand),
    standard: runBucket(f, outlay, STANDARD_VAULT_PCT, inHand),
  };
}
