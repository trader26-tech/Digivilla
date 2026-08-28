/**
 * PropertyNest package data — the desk's EXACT published allocations, per-fund
 * monthly-withdrawal amounts, and the bucket/withdrawal rules, for all four
 * tiers. This is the single source of truth the property-detail page reads.
 *
 * All figures are illustrative, not guaranteed. Rent starts month 13 (a 12-month
 * possession period). Growth funds NEVER pay monthly — they feed the income
 * sleeve once a year via a client-approved switch. Liquid is emergency-only.
 *
 * The scheme_code on each leg is the AMFI code we actually analyse against real
 * NAV history (a couple of labels map to the closest available scheme). Legs
 * without a code (e.g. a second arbitrage sleeve that mirrors the first) reuse a
 * representative code so the blended-basket analytics stay honest.
 */

export type PropertyKey = 'land' | 'flat' | 'apartment' | 'duplex';
export type VariantKey = 'conservative' | 'balanced' | 'aggressive';

/** What a fund leg does inside the bucket machine. Drives the flow diagram. */
export type LegRole =
  | 'income'   // arbitrage/equity-savings sleeve an SWP is drawn from
  | 'growth'   // pure appreciation; feeds income annually, never pays monthly
  | 'liquid'   // emergency-only reserve, refilled from growth later
  | 'hedge';   // dynamic/multi-asset cushion that tames drawdowns

export interface Leg {
  scheme_code: number;
  label: string;        // the fund name the customer sees
  weight: number;       // 0..1 of the ticket
  role: LegRole;
  /** Monthly SWP actually drawn from THIS leg (₹). 0 for growth/most legs. */
  withdrawMonthly: number;
  /** The sustainable ceiling this leg could pay (₹), for the "headroom" note. */
  withdrawMax: number;
  /** One-line "why it's here / what it does". */
  note: string;
}

export interface Variant {
  key: VariantKey;
  label: string;          // property-world name shown on the storefront
  storeLabel: string;     // 'Ready-to-move' | 'Under construction' | 'Pre-launch'
  blurb: string;          // one-line positioning
  accent: string;         // css var for the risk tone
  targetGrowth: number;   // headline expected growth % p.a. (gross)
  netGrowth?: number;     // after the income drag, for income tiers
  rentMonthly: number;    // total monthly income this variant targets (₹); 0 = Land
  legs: Leg[];
}

export interface PropertyPackage {
  key: PropertyKey;
  name: string;
  price: number;          // ticket size (₹)
  incomePays: boolean;    // false only for Land (pure accumulation)
  /** Property-world → risk mapping used by the storefront rows. */
  variants: Record<VariantKey, Variant>;
}

/** Human-readable roles for the flow diagram + legend. */
export const ROLE_LABEL: Record<LegRole, string> = {
  income: 'Income sleeve',
  growth: 'Growth engine',
  liquid: 'Emergency reserve',
  hedge: 'Drawdown cushion',
};

/** The withdrawal rules, shown verbatim on every income tier's page. */
export const WITHDRAWAL_RULES: string[] = [
  'No withdrawals in months 1–12 — that is the possession period. Rent starts month 13.',
  'The SWP runs only on the income sleeve (arbitrage / equity-savings). Growth funds never pay monthly; they top up that sleeve once a year via a switch you approve.',
  'If the arbitrage sleeve falls below 24 months of rent, we propose a switch: Equity Savings → Arbitrage, to refill the runway.',
  'The liquid fund pays rent only in an emergency month, and is refilled from growth later.',
  'Every rent and growth figure is illustrative — not guaranteed.',
];

/** Why the income sleeve is arbitrage — the tax-efficiency story. */
export const TAX_NOTE =
  'The rent is drawn from an arbitrage fund, which is taxed as equity: gains held ' +
  'over a year are long-term (12.5% above the ₹1.25L annual exemption) rather than ' +
  'taxed at your slab like a debt fund or an annuity. And because it is an SWP, each ' +
  'payout is mostly your own capital returning — only the gain portion is taxed — so ' +
  'the effective tax on your monthly income stays very low.';

// AMFI scheme codes reused across tiers (closest analysable scheme per label).
const KOTAK_ARBITRAGE = 102885;
const EDELWEISS_ARBITRAGE = 118989;
const ICICI_EQ_SAVINGS = 102330;
const ICICI_LIQUID = 100309;
const ICICI_MULTI_ASSET = 120251;
const ICICI_BLUECHIP = 120586;
const PPFAS_FLEXI = 122640;
const HDFC_BAL_ADV = 100119;
const HDFC_FLEXI = 118989 + 1; // representative; HDFC Flexi Cap
const HDFC_MIDCAP = 105758;
const MOTILAL_LMC = 147704;
const NIPPON_SMALL = 113177;
const HDFC_FLEXI_CAP = 101762;

export const PACKAGES: Record<PropertyKey, PropertyPackage> = {
  // ============================ LAND — pure accumulation, NO income ===========
  land: {
    key: 'land',
    name: 'Land',
    price: 10_00_000,
    incomePays: false,
    variants: {
      conservative: {
        key: 'conservative', label: 'Ready-to-move', storeLabel: 'Ready-to-move',
        blurb: 'Steadiest path — a debt-cushioned core that rides out the dips.',
        accent: 'var(--positive)', targetGrowth: 10.2, rentMonthly: 0,
        legs: [
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.25, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'Hedged equity + debt — the shock absorber' },
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.40, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'Shifts equity↔debt to cushion drawdowns' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.35, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Diversified growth engine' },
        ],
      },
      balanced: {
        key: 'balanced', label: 'Under construction', storeLabel: 'Under construction',
        blurb: 'The all-weather middle — real growth, without a stomach-churning ride.',
        accent: 'var(--brass)', targetGrowth: 11.8, rentMonthly: 0,
        legs: [
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.20, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'The debt cushion that tames the swings' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.45, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core diversified compounder' },
          { scheme_code: MOTILAL_LMC, label: 'Motilal Oswal Large and Midcap', weight: 0.35, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'A midcap tilt for the extra growth' },
        ],
      },
      aggressive: {
        key: 'aggressive', label: 'Pre-launch', storeLabel: 'Pre-launch',
        blurb: 'Built to appreciate — maximum compounding for the long horizon.',
        accent: 'var(--terracotta)', targetGrowth: 12.9, rentMonthly: 0,
        legs: [
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.40, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'A diversified anchor under the higher-beta legs' },
          { scheme_code: HDFC_MIDCAP, label: 'HDFC Mid-Cap Opportunities', weight: 0.35, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'The midcap growth core' },
          { scheme_code: NIPPON_SMALL, label: 'Nippon India Small Cap', weight: 0.25, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Small-cap kicker — highest potential, highest swings' },
        ],
      },
    },
  },

  // ============================ FLAT — ₹25,00,000 ============================
  flat: {
    key: 'flat',
    name: 'Flat',
    price: 25_00_000,
    incomePays: true,
    variants: {
      conservative: {
        key: 'conservative', label: 'Ready-to-move', storeLabel: 'Ready-to-move',
        blurb: 'Steadiest rent — a big arbitrage sleeve pays you, growth compounds quietly behind it.',
        accent: 'var(--positive)', targetGrowth: 8.3, netGrowth: 5.9, rentMonthly: 5_000,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.40, role: 'income', withdrawMonthly: 5_000, withdrawMax: 5_417, note: 'Your rent is drawn from here (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.15, role: 'income', withdrawMonthly: 0, withdrawMax: 2_500, note: 'Backup income sleeve — refills arbitrage annually' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.10, role: 'liquid', withdrawMonthly: 0, withdrawMax: 1_250, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.20, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Diversified compounder — feeds income annually' },
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.15, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'Cushions the drawdowns' },
        ],
      },
      balanced: {
        key: 'balanced', label: 'Under construction', storeLabel: 'Under construction',
        blurb: 'More growth behind the rent — two income sleeves share the monthly payout.',
        accent: 'var(--brass)', targetGrowth: 9.6, netGrowth: 6.6, rentMonthly: 6_250,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.25, role: 'income', withdrawMonthly: 3_300, withdrawMax: 3_385, note: 'Primary rent sleeve (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.20, role: 'income', withdrawMonthly: 2_950, withdrawMax: 3_333, note: 'Second rent sleeve, splits the payout' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 625, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.30, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder — feeds income annually' },
          { scheme_code: MOTILAL_LMC, label: 'Motilal Oswal Large and Midcap', weight: 0.20, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap tilt for extra growth' },
        ],
      },
      aggressive: {
        key: 'aggressive', label: 'Pre-launch', storeLabel: 'Pre-launch',
        blurb: 'Rent plus a multi-asset payout, with the most growth compounding behind it.',
        accent: 'var(--terracotta)', targetGrowth: 10.3, netGrowth: 6.7, rentMonthly: 7_500,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.15, role: 'income', withdrawMonthly: 2_000, withdrawMax: 2_031, note: 'Rent sleeve (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.15, role: 'income', withdrawMonthly: 2_400, withdrawMax: 2_500, note: 'Second rent sleeve' },
          { scheme_code: ICICI_MULTI_ASSET, label: 'ICICI Pru Multi-Asset', weight: 0.15, role: 'income', withdrawMonthly: 3_100, withdrawMax: 3_281, note: 'Multi-asset payout sleeve — gold+debt+equity' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 625, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.30, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder — feeds income annually' },
          { scheme_code: HDFC_MIDCAP, label: 'HDFC Mid-Cap Opportunities', weight: 0.20, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap growth core' },
        ],
      },
    },
  },

  // ============================ APARTMENT — ₹50,00,000 ======================
  apartment: {
    key: 'apartment',
    name: 'Apartment',
    price: 50_00_000,
    incomePays: true,
    variants: {
      conservative: {
        key: 'conservative', label: 'Ready-to-move', storeLabel: 'Ready-to-move',
        blurb: 'A large arbitrage sleeve pays a steady ₹10,000, six funds spread the risk.',
        accent: 'var(--positive)', targetGrowth: 8.3, netGrowth: 5.9, rentMonthly: 10_000,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.40, role: 'income', withdrawMonthly: 10_000, withdrawMax: 10_833, note: 'Your rent is drawn from here (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.15, role: 'income', withdrawMonthly: 0, withdrawMax: 5_000, note: 'Backup income sleeve — refills arbitrage annually' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.10, role: 'liquid', withdrawMonthly: 0, withdrawMax: 2_500, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.15, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Diversified compounder — feeds income annually' },
          { scheme_code: ICICI_BLUECHIP, label: 'ICICI Pru Bluechip', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Large-cap ballast' },
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.10, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'Cushions the drawdowns' },
        ],
      },
      balanced: {
        key: 'balanced', label: 'Under construction', storeLabel: 'Under construction',
        blurb: 'Two income sleeves pay ₹12,500 while a bigger growth core compounds behind them.',
        accent: 'var(--brass)', targetGrowth: 9.5, netGrowth: 6.5, rentMonthly: 12_500,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.25, role: 'income', withdrawMonthly: 6_600, withdrawMax: 6_771, note: 'Primary rent sleeve (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.20, role: 'income', withdrawMonthly: 5_900, withdrawMax: 6_667, note: 'Second rent sleeve, splits the payout' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 1_250, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.25, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder — feeds income annually' },
          { scheme_code: MOTILAL_LMC, label: 'Motilal Oswal Large and Midcap', weight: 0.15, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap tilt for extra growth' },
          { scheme_code: ICICI_MULTI_ASSET, label: 'ICICI Pru Multi-Asset', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 4_375, note: 'Multi-asset diversifier' },
        ],
      },
      aggressive: {
        key: 'aggressive', label: 'Pre-launch', storeLabel: 'Pre-launch',
        blurb: 'Three sleeves pay ₹15,000, with small/mid growth compounding hardest behind them.',
        accent: 'var(--terracotta)', targetGrowth: 10.5, netGrowth: 6.9, rentMonthly: 15_000,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.10, role: 'income', withdrawMonthly: 2_700, withdrawMax: 2_708, note: 'Rent sleeve (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.20, role: 'income', withdrawMonthly: 6_300, withdrawMax: 6_667, note: 'Second rent sleeve' },
          { scheme_code: ICICI_MULTI_ASSET, label: 'ICICI Pru Multi-Asset', weight: 0.15, role: 'income', withdrawMonthly: 6_000, withdrawMax: 6_563, note: 'Multi-asset payout sleeve' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 1_250, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.25, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder — feeds income annually' },
          { scheme_code: HDFC_MIDCAP, label: 'HDFC Mid-Cap Opportunities', weight: 0.15, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap growth core' },
          { scheme_code: NIPPON_SMALL, label: 'Nippon India Small Cap', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Small-cap kicker' },
        ],
      },
    },
  },

  // ============================ DUPLEX — ₹99,00,000 =========================
  duplex: {
    key: 'duplex',
    name: 'Duplex',
    price: 99_00_000,
    incomePays: true,
    variants: {
      conservative: {
        key: 'conservative', label: 'Ready-to-move', storeLabel: 'Ready-to-move',
        blurb: 'Two arbitrage sleeves split a ₹19,800 rent; seven funds keep it well spread.',
        accent: 'var(--positive)', targetGrowth: 8.3, netGrowth: 5.9, rentMonthly: 19_800,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.20, role: 'income', withdrawMonthly: 9_900, withdrawMax: 10_725, note: 'Half your rent (equity-taxed SWP)' },
          { scheme_code: EDELWEISS_ARBITRAGE, label: 'Edelweiss Arbitrage', weight: 0.20, role: 'income', withdrawMonthly: 9_900, withdrawMax: 10_725, note: 'The other half — a second AMC spreads the sleeve' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.15, role: 'income', withdrawMonthly: 0, withdrawMax: 9_900, note: 'Backup income sleeve — refills arbitrage annually' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.10, role: 'liquid', withdrawMonthly: 0, withdrawMax: 4_950, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Diversified compounder' },
          { scheme_code: HDFC_FLEXI_CAP, label: 'HDFC Flexi Cap', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'A second flexi-cap for spread' },
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.15, role: 'hedge', withdrawMonthly: 0, withdrawMax: 0, note: 'Cushions the drawdowns' },
        ],
      },
      balanced: {
        key: 'balanced', label: 'Under construction', storeLabel: 'Under construction',
        blurb: 'Three sleeves pay ₹24,750, with a broad growth core compounding behind it.',
        accent: 'var(--brass)', targetGrowth: 9.5, netGrowth: 6.5, rentMonthly: 24_750,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.125, role: 'income', withdrawMonthly: 6_600, withdrawMax: 6_703, note: 'Rent sleeve (equity-taxed SWP)' },
          { scheme_code: EDELWEISS_ARBITRAGE, label: 'Edelweiss Arbitrage', weight: 0.125, role: 'income', withdrawMonthly: 6_600, withdrawMax: 6_703, note: 'Second arbitrage AMC spreads the sleeve' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.20, role: 'income', withdrawMonthly: 11_550, withdrawMax: 13_200, note: 'Largest rent sleeve' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 2_475, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.125, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder' },
          { scheme_code: HDFC_FLEXI_CAP, label: 'HDFC Flexi Cap', weight: 0.125, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Second flexi-cap for spread' },
          { scheme_code: MOTILAL_LMC, label: 'Motilal Oswal Large and Midcap', weight: 0.15, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap tilt' },
          { scheme_code: ICICI_MULTI_ASSET, label: 'ICICI Pru Multi-Asset', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 8_663, note: 'Multi-asset diversifier' },
        ],
      },
      aggressive: {
        key: 'aggressive', label: 'Pre-launch', storeLabel: 'Pre-launch',
        blurb: 'Four sleeves pay ₹29,700, with small/mid growth compounding hardest behind them.',
        accent: 'var(--terracotta)', targetGrowth: 10.6, netGrowth: 7.0, rentMonthly: 29_700,
        legs: [
          { scheme_code: KOTAK_ARBITRAGE, label: 'Kotak Equity Arbitrage', weight: 0.10, role: 'income', withdrawMonthly: 5_300, withdrawMax: 5_363, note: 'Rent sleeve (equity-taxed SWP)' },
          { scheme_code: ICICI_EQ_SAVINGS, label: 'ICICI Pru Equity Savings', weight: 0.15, role: 'income', withdrawMonthly: 9_700, withdrawMax: 9_900, note: 'Largest rent sleeve' },
          { scheme_code: HDFC_BAL_ADV, label: 'HDFC Balanced Advantage', weight: 0.10, role: 'income', withdrawMonthly: 8_200, withdrawMax: 8_250, note: 'Balanced-advantage payout sleeve' },
          { scheme_code: ICICI_MULTI_ASSET, label: 'ICICI Pru Multi-Asset', weight: 0.10, role: 'income', withdrawMonthly: 6_500, withdrawMax: 8_663, note: 'Multi-asset payout sleeve' },
          { scheme_code: ICICI_LIQUID, label: 'ICICI Pru Liquid', weight: 0.05, role: 'liquid', withdrawMonthly: 0, withdrawMax: 2_475, note: 'Emergency only — refilled from growth later' },
          { scheme_code: PPFAS_FLEXI, label: 'Parag Parikh Flexi Cap', weight: 0.125, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Core compounder' },
          { scheme_code: HDFC_FLEXI_CAP, label: 'HDFC Flexi Cap', weight: 0.125, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Second flexi-cap for spread' },
          { scheme_code: HDFC_MIDCAP, label: 'HDFC Mid-Cap Opportunities', weight: 0.15, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Midcap growth core' },
          { scheme_code: NIPPON_SMALL, label: 'Nippon India Small Cap', weight: 0.10, role: 'growth', withdrawMonthly: 0, withdrawMax: 0, note: 'Small-cap kicker' },
        ],
      },
    },
  },
};

/** Convenience: the ordered variant keys, matching the storefront row order. */
export const VARIANT_ORDER: VariantKey[] = ['conservative', 'balanced', 'aggressive'];

/** Sum of monthly SWP across the income sleeve, for a variant. */
export function totalMonthlyIncome(v: Variant): number {
  return v.legs.reduce((s, l) => s + l.withdrawMonthly, 0);
}

/** Months of rent the income sleeve can cover at the target rent = the runway. */
export function runwayMonths(v: Variant, ticket: number): number {
  if (v.rentMonthly <= 0) return 0;
  const incomeCorpus = v.legs
    .filter((l) => l.role === 'income')
    .reduce((s, l) => s + l.weight * ticket, 0);
  return Math.round(incomeCorpus / v.rentMonthly);
}
