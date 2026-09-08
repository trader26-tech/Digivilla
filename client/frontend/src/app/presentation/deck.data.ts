/**
 * The "₹1 crore, two ways" pitch deck — rebuilt as native, in-app slides.
 *
 * Each slide is a typed record the PresentationComponent renders with the
 * deck's own editorial identity (cream ground, forest-green ink, gold coin).
 * Faithful to the original 13-slide deck, but native to the app: our own
 * left/right controls, our own charts, works offline, no external chrome.
 */

export type SlideKind =
  | 'cover'
  | 'stat-split'      // big split: what you keep vs what's lost
  | 'breakdown'       // a list of line items summing to a total
  | 'rent-hero'       // the ₹25,000 × 12 = ₹3,00,000 math
  | 'flow'            // the ₹3L → ₹1.925L waterfall
  | 'divisible'       // financial asset vs indivisible house
  | 'liquidity'       // shares 2 days vs house 6 months
  | 'solution'        // Digi City reveal (isometric villa + coin)
  | 'two-things'      // rental income + growth
  | 'build'           // the 5-fund allocation on day one
  | 'after'           // after 15 years — the two engines
  | 'disclaimer'      // please read — it's a mutual fund
  | 'cta';            // compare your flat

export interface Slide {
  kind: SlideKind;
  eyebrow?: string;
  title?: string;
  sub?: string;
  data?: any;
}

/** ₹ formatting used across the deck. */
export const SLIDES: Slide[] = [
  // 1 · COVER
  {
    kind: 'cover',
    eyebrow: 'Tamil Nadu · 2026',
    title: 'You pay ₹1 crore\nfor a flat.',
    sub: 'What does that money actually buy you?',
    data: { badge: '₹1 crore', badgeSub: 'the price you pay' },
  },

  // 2 · ENTRY COST split
  {
    kind: 'stat-split',
    eyebrow: '01 · Entry cost',
    title: '₹1 crore buys you a flat worth ₹86 lakh.',
    data: {
      keep: { value: '₹86 lakh', label: 'the flat you actually own' },
      lost: { value: '₹14 lakh', label: 'gone to costs, before the keys' },
    },
  },

  // 3 · WHERE THE ₹14 LAKH GOES
  {
    kind: 'breakdown',
    eyebrow: '01 · Entry cost',
    title: 'Where the ₹14 lakh goes',
    sub: 'Paid before the keys. Never comes back.',
    data: {
      items: [
        { name: 'Stamp duty', value: '₹7,00,000', pct: 50 },
        { name: 'Registration', value: '₹4,00,000', pct: 29 },
        { name: 'Brokerage, legal, society', value: '₹3,00,000', pct: 21 },
      ],
      total: '₹14 lakh',
    },
  },

  // 4 · RENT HERO
  {
    kind: 'rent-hero',
    eyebrow: '02 · Rent',
    title: 'Then it starts paying you.',
    sub: 'Before any of the costs of being a landlord.',
    data: { a: '₹25,000', aSub: 'a month', b: '12', bSub: 'months', c: '₹3,00,000', cSub: 'a year, gross' },
  },

  // 5 · THE FLOW (₹3L → ₹1.925L)
  {
    kind: 'flow',
    eyebrow: '02 · Rent',
    title: '₹3 lakh comes in. ₹1.925 lakh stays.',
    data: {
      steps: [
        { k: 'Gross rent · ₹25,000 × 12', v: '₹3,00,000', tone: 'in' },
        { k: 'One month vacant', v: '−₹25,000', tone: 'out' },
        { k: 'Rent actually collected', v: '₹2,75,000', tone: 'mid' },
        { k: 'Income tax @ 30%', v: '−₹82,500', tone: 'out' },
      ],
      keep: { v: '₹1,92,500', note: '1.93% on ₹1 crore deployed' },
    },
  },

  // 6 · DIVISIBILITY
  {
    kind: 'divisible',
    eyebrow: '03 · Divisibility',
    title: 'A house has no ₹20 lakh slice.',
    data: {
      financial: { title: 'Financial assets · divisible', slice: '₹20 lakh', note: 'The remaining ₹80 lakh stays invested, untouched.' },
      house: { title: 'One house · indivisible', note: 'Raising ₹20 lakh means selling the whole ₹1 crore — or none.' },
    },
  },

  // 7 · ILLIQUIDITY
  {
    kind: 'liquidity',
    eyebrow: '04 · Illiquidity',
    title: 'Easy to list. Slow to cash.',
    sub: 'Selling takes 6 months, and the money never arrives whole — brokerage comes off the top and 1% TDS is withheld by the buyer.',
    data: {
      rows: [
        { name: 'Shares', time: '2 days', fast: true },
        { name: 'This house', time: '6 months', fast: false },
      ],
      costs: [
        { k: 'Brokerage', v: '−₹2,00,000', pct: '2%' },
        { k: 'TDS withheld · 1%', v: '−₹1,00,000', pct: '1%' },
      ],
      inHand: '₹0.97 Cr in hand', outCost: 'Cost to get out · 3% of ₹1 crore',
    },
  },

  // 8 · SOLUTION — DIGI CITY
  {
    kind: 'solution',
    eyebrow: 'The solution',
    title: 'Digi City',
  },

  // 9 · TWO THINGS
  {
    kind: 'two-things',
    eyebrow: 'What is this?',
    title: 'Any property is two things.',
    data: {
      a: { title: 'Rental income', note: 'What the tenant pays you every month' },
      b: { title: 'Growth', note: 'What the plot itself becomes worth over time' },
    },
  },

  // 10 · THE BUILD (5 funds)
  {
    kind: 'build',
    eyebrow: 'The build',
    title: 'Where the ₹1 crore goes on day one.',
    sub: 'Five funds · one purchase each · regular plan, growth option.',
    data: {
      total: '₹1,00,00,000',
      swp: { label: 'Monthly SWP', value: '₹30,000', note: 'from the vault only' },
      funds: [
        { role: 'Arbitrage · the vault', name: 'Nippon India Arbitrage Fund', amt: '₹36,00,000', pct: 36, tone: 'vault' },
        { role: 'Gold', name: 'Nippon India Gold Savings Fund', amt: '₹16,00,000', pct: 16, tone: 'gold' },
        { role: 'Large cap · grown', name: 'Nippon India Large Cap Fund', amt: '₹16,00,000', pct: 16, tone: 'tree' },
        { role: 'Mid cap · growing', name: 'Nippon India Growth Mid Cap Fund', amt: '₹16,00,000', pct: 16, tone: 'tree' },
        { role: 'Small cap · seedling', name: 'Nippon India Small Cap Fund', amt: '₹16,00,000', pct: 16, tone: 'tree' },
      ],
      foot: 'One purchase of five funds. One SWP mandate on the vault. The four trees are never touched — they just compound.',
    },
  },

  // 11 · AFTER 15 YEARS
  {
    kind: 'after',
    eyebrow: 'After 15 years',
    title: '₹1 crore became ₹7.69 Cr.',
    data: {
      headline: { value: '₹7.69 Cr', invested: '₹7.13 Cr still invested', paid: '+ ₹55.8 L paid out as monthly income' },
      vault: {
        title: 'The vault paid the income',
        rows: [
          { k: 'Started with', v: '₹36.0 L' },
          { k: 'Earned at 6.74%', v: '+₹27.1 L' },
          { k: 'Paid out · ₹30,000 × 186', v: '−₹55.8 L' },
          { k: 'Left in the vault', v: '₹7.3 L' },
        ],
      },
      trees: {
        title: 'Four sleeves never touched · ₹64 L in → ₹6.42 Cr out',
        rows: [
          { name: 'Gold', mult: '6.0×', cagr: '12.3%', val: '₹0.96 Cr' },
          { name: 'Large cap', mult: '7.3×', cagr: '13.7%', val: '₹1.16 Cr' },
          { name: 'Mid cap', mult: '10.5×', cagr: '16.4%', val: '₹1.68 Cr' },
          { name: 'Small cap', mult: '20.3×', cagr: '21.5%', val: '₹3.25 Cr' },
        ],
      },
      foot: 'The vault is spent down so the trees never have to be.',
    },
  },

  // 12 · DISCLAIMER
  {
    kind: 'disclaimer',
    eyebrow: 'Please read',
    title: 'This is a mutual fund portfolio, not property.',
    data: {
      points: [
        { k: 'You are buying units', d: 'Units in mutual funds, held in your own name with the AMC — not a plot, villa or penthouse.' },
        { k: 'Not rent', d: 'The monthly amount is a withdrawal (SWP) from your own units, not rent.' },
        { k: 'Value can fall', d: 'The value of your investment can fall (−25–30% in a bad year).' },
        { k: 'Not property', d: 'You cannot live in it, let it, or transfer it as property.' },
      ],
      fine: 'Mutual fund investments are subject to market risks. Read all scheme related documents carefully. Past performance is not indicative of future returns. Projections are illustrations, not forecasts.',
    },
  },

  // 13 · CTA
  {
    kind: 'cta',
    eyebrow: 'Next step',
    title: 'Compare your flat.',
    sub: 'Bring the price, the loan and the expected rent. We’ll run the same arithmetic on your numbers.',
    data: { fine: 'Mutual fund investments are subject to market risks. AMFI-registered Mutual Fund Distributor.' },
  },
];
