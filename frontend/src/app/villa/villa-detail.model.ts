/**
 * Self-contained data + math for the villa detail page.
 *
 * Illustrative for now: the growth curve, rent and fund mix are computed
 * in-app from the villa's price so the page is fully self-sufficient. Swap
 * these for live NAV/basket data later without touching the component.
 */

/** One point on the value-over-time curve. */
export interface GrowthPoint {
  year: number;   // 0..N
  value: number;  // rupees
}

/** A fund inside the villa basket, with its weight. */
export interface HoldingFund {
  name: string;
  assetClass: 'equity' | 'hybrid' | 'debt' | 'gold';
  weight: number;   // 0..1
  return3y: number; // trailing 3-yr %, illustrative
}

/** Everything the villa page renders, derived from the price. */
export interface VillaPlan {
  price: number;
  years: number;
  cagr: number;            // blended expected annual return
  growth: GrowthPoint[];   // price -> future value, year by year
  finalValue: number;
  rentMonthly: number;     // ~6% p.a. of price, monthly
  rentYearly: number;
  rentYieldPct: number;
  funds: HoldingFund[];    // weights sum to 1
}

/** A curated 4-fund villa basket. Fixed for now; weights sum to 1. */
const VILLA_FUNDS: HoldingFund[] = [
  { name: 'Parag Parikh Flexi Cap',        assetClass: 'equity', weight: 0.40, return3y: 21.4 },
  { name: 'HDFC Balanced Advantage',       assetClass: 'hybrid', weight: 0.25, return3y: 16.8 },
  { name: 'ICICI Pru Corporate Bond',      assetClass: 'debt',   weight: 0.20, return3y: 7.6 },
  { name: 'Nippon India Gold Savings',     assetClass: 'gold',   weight: 0.15, return3y: 13.2 },
];

/** Blended expected annual return from the fund mix (illustrative priors). */
function blendedCagr(funds: HoldingFund[]): number {
  const prior: Record<HoldingFund['assetClass'], number> = {
    equity: 13.5, hybrid: 10.5, debt: 7.0, gold: 9.0,
  };
  return funds.reduce((s, f) => s + f.weight * prior[f.assetClass], 0);
}

/**
 * Build the full plan for a villa of the given price over `years`.
 * Growth compounds the lump sum at the blended CAGR; rent is a steady ~6%
 * yield paid monthly.
 */
export function villaPlan(price: number, years = 20): VillaPlan {
  const funds = VILLA_FUNDS;
  const cagr = blendedCagr(funds);
  const r = cagr / 100;

  const growth: GrowthPoint[] = [];
  for (let y = 0; y <= years; y++) {
    growth.push({ year: y, value: price * (1 + r) ** y });
  }
  const finalValue = growth[growth.length - 1].value;

  const rentYieldPct = 6;
  const rentYearly = (price * rentYieldPct) / 100;
  const rentMonthly = rentYearly / 12;

  return {
    price,
    years,
    cagr,
    growth,
    finalValue,
    rentMonthly,
    rentYearly,
    rentYieldPct,
    funds,
  };
}

/** Brand colour for an asset class (matches the estate palette). */
export function assetColor(a: HoldingFund['assetClass']): string {
  return {
    equity: '#2E6B4F',
    hybrid: '#A67C2E',
    debt: '#3C7FA8',
    gold: '#C9A227',
  }[a];
}

export function assetLabel(a: HoldingFund['assetClass']): string {
  return { equity: 'Equity', hybrid: 'Hybrid', debt: 'Debt', gold: 'Gold' }[a];
}
