import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BasketMetrics, LandDetailService } from './land-detail.service';
import { schemeName, schemeLocality, past3y, past5y } from './property-package.data';
import { RevealDirective } from './reveal.directive';

export type LandVariantKey = 'conservative' | 'balanced' | 'aggressive';

/** True underlying asset-class split for a fund (look-through), as fractions
 *  that sum to 1. Based on each category's typical composition. */
interface LookThrough {
  equity: number;
  debt: number;
  gold: number;
  cash: number;   // arbitrage / cash & equivalents
}

/** One fund leg of a land basket. */
interface Leg {
  scheme_code: number;
  label: string;   // the name the customer sees
  weight: number;  // 0..1
  role: string;    // one-line "why it's here"
  look: LookThrough;
}

interface LandVariant {
  key: LandVariantKey;
  name: string;          // the TILE name shown to the customer (no risk jargon)
  blurb: string;         // one-line positioning
  targetGrowth: number;  // headline expected growth the storefront advertises
  legs: Leg[];
}

interface ProjRow {
  year: number;
  low: number;
  mid: number;
  high: number;
}

/** A slice of the rolled-up look-through allocation. */
interface AllocSlice {
  key: 'equity' | 'debt' | 'gold' | 'cash';
  label: string;
  pct: number;   // 0..100
}

/** The land baskets. Variant NAMES mirror the storefront tiles the customer
 *  tapped in — "Ready-to-move / Under construction / Pre-launch" — never the
 *  risk words. Capital appreciation only; there is NO rental income. */
const VARIANTS: LandVariant[] = [
  {
    key: 'conservative',
    name: 'Low risk',
    blurb: 'Steadiest path — a debt-cushioned core that rides out the dips.',
    targetGrowth: 10.2,
    legs: [
      { scheme_code: 102330, label: 'ICICI Pru Equity Savings', weight: 0.25, role: 'Hedged equity + debt — the shock absorber',
        look: { equity: 0.35, debt: 0.30, gold: 0, cash: 0.35 } },
      { scheme_code: 100119, label: 'HDFC Balanced Advantage', weight: 0.40, role: 'Shifts equity↔debt to cushion drawdowns',
        look: { equity: 0.50, debt: 0.35, gold: 0, cash: 0.15 } },
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.35, role: 'Diversified growth engine',
        look: { equity: 0.80, debt: 0.05, gold: 0, cash: 0.15 } },
    ],
  },
  {
    key: 'balanced',
    name: 'Medium risk',
    blurb: 'The all-weather middle — real growth, without a churning ride.',
    targetGrowth: 11.8,
    legs: [
      { scheme_code: 100119, label: 'HDFC Balanced Advantage', weight: 0.20, role: 'The debt cushion that tames the swings',
        look: { equity: 0.50, debt: 0.35, gold: 0, cash: 0.15 } },
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.45, role: 'Core diversified compounder',
        look: { equity: 0.80, debt: 0.05, gold: 0, cash: 0.15 } },
      { scheme_code: 147701, label: 'Motilal Oswal Large and Midcap', weight: 0.35, role: 'A midcap tilt for the extra growth',
        look: { equity: 0.98, debt: 0, gold: 0, cash: 0.02 } },
    ],
  },
  {
    key: 'aggressive',
    name: 'High risk',
    blurb: 'Built to appreciate — maximum compounding for the long horizon.',
    targetGrowth: 12.9,
    legs: [
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.40, role: 'A diversified anchor under the higher-beta legs',
        look: { equity: 0.80, debt: 0.05, gold: 0, cash: 0.15 } },
      { scheme_code: 105758, label: 'HDFC Mid-Cap Opportunities', weight: 0.35, role: 'The midcap growth core',
        look: { equity: 0.95, debt: 0, gold: 0, cash: 0.05 } },
      { scheme_code: 113177, label: 'Nippon India Small Cap', weight: 0.25, role: 'Small-cap kicker — highest potential',
        look: { equity: 0.95, debt: 0, gold: 0, cash: 0.05 } },
    ],
  },
];

const HORIZONS = [1, 3, 5, 10, 20];

/** One selectable line on the "how it moved" chart: the blend, or a single fund. */
interface ChartSource {
  id: string;         // 'blend' | scheme_code as string
  label: string;
}

@Component({
  selector: 'app-land-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RevealDirective],
  templateUrl: './land-detail.component.html',
  styleUrl: './land-detail.component.scss',
})
export class LandDetailComponent implements OnInit, OnDestroy {
  @Input() initialVariant: LandVariantKey = 'balanced';
  @Output() back = new EventEmitter<void>();

  private api = inject(LandDetailService);

  readonly variants = VARIANTS;
  readonly horizons = HORIZONS;
  readonly ticketPrice = 10_00_000;

  active = signal<LandVariantKey>('balanced');

  /** How many plots the customer is buying (each plot = one ₹10L ticket). */
  plots = signal<number>(1);
  /** The invested amount derived from the number of plots. */
  amount = computed<number>(() => this.plots() * this.ticketPrice);

  /** Which ratio row is expanded to show its plain-English meaning (or null). */
  openRatio = signal<string | null>(null);
  toggleRatio(key: string): void {
    this.openRatio.update(cur => (cur === key ? null : key));
  }

  /** Plain-English meaning for each ratio, shown when its row is tapped. */
  readonly ratioInfo: Record<string, string> = {
    sharpe: 'Return earned for each unit of risk taken. Higher is better — it means the basket is paying you well for the ups and downs it puts you through. Above ~0.5 is solid for an equity mix.',
    beta: 'How much this basket moves versus the whole market (market = 1.0). Below 1.0 means it swings less than the market; above 1.0 means it swings more. Lower beta = a calmer ride.',
    history: 'How many years of real fund history these numbers are measured over. More years means the returns and the worst drawdown have been tested through more market cycles — so you can trust them more.',
  };

  /** Blended metrics per variant. */
  metrics = signal<Record<string, BasketMetrics>>({});
  /** Per-fund metrics cache, keyed by scheme_code. */
  fundMetrics = signal<Record<number, BasketMetrics>>({});
  loading = signal(true);
  error = signal<string | null>(null);

  /** Which line the growth chart is showing: 'blend' or a scheme_code. */
  chartSource = signal<string>('blend');

  /** Time-range windows for the Past-performance chart (months). Default 3Y. */
  readonly ranges: { key: string; label: string; months: number }[] = [
    { key: '1y', label: '1Y', months: 12 },
    { key: '2y', label: '2Y', months: 24 },
    { key: '3y', label: '3Y', months: 36 },
    { key: '5y', label: '5Y', months: 60 },
  ];
  chartRange = signal<string>('3y');
  setRange(key: string): void { this.chartRange.set(key); }

  /** "3 years ago" etc., for the plain-English performance readout. */
  rangeWords(): string {
    const n = parseInt(this.chartRange(), 10) || 3;
    return n === 1 ? '1 year ago' : `${n} years ago`;
  }

  activeVariant = computed(() => this.variants.find(v => v.key === this.active())!);
  activeMetrics = computed<BasketMetrics | null>(() => this.metrics()[this.active()] ?? null);

  /** The plot's name EXACTLY as the tapped tile shows it: "<scheme> Land". */
  plotName = computed(() => `${schemeName('land', this.active())} Land`);
  plotLocality = computed(() => schemeLocality('land', this.active()));

  /** Hero growth ratios are hidden until tapped. */
  heroDetailsOpen = signal(false);
  toggleHeroDetails(): void { this.heroDetailsOpen.update(v => !v); }

  /** Long-run expected return assumption per asset class (%), matching the
   *  backend engine's priors — used to explain the forward growth figure. */
  private readonly ASSET_PRIOR: Record<string, number> = { equity: 12, hybrid: 10, gold: 8, debt: 6.8, cash: 6.8 };
  private readonly ASSET_LABEL: Record<string, string> = { equity: 'Equity', hybrid: 'Hybrid', gold: 'Gold', debt: 'Debt', cash: 'Cash / arbitrage' };

  /** Reconstructs, transparently, HOW the forward growth figure is built:
   *  final = 50% × the basket's real historical CAGR + 50% × the weighted
   *  asset-class assumption. Returned as parts for the explainer UI. */
  growthBreakdown = computed(() => {
    const m = this.activeMetrics();
    if (!m) return null;
    const mix = m.asset_mix || {};
    // weighted asset-class prior
    const rows = Object.entries(mix)
      .map(([k, pctVal]) => ({
        key: k,
        label: this.ASSET_LABEL[k] ?? k,
        weight: pctVal as number,               // % of the basket in this class
        rate: this.ASSET_PRIOR[k] ?? 10,         // long-run assumption for it
        contrib: ((pctVal as number) / 100) * (this.ASSET_PRIOR[k] ?? 10),
      }))
      .sort((a, b) => b.weight - a.weight);
    const prior = rows.reduce((s, r) => s + r.contrib, 0);
    const observed = m.cagr ?? prior;            // real measured CAGR over full history
    const expected = m.expected_return ?? (0.5 * prior + 0.5 * observed);
    return { rows, prior, observed, expected, historyYears: m.history_years };
  });

  /** The forward growth % shown in the hero (same source as the tile). */
  forwardGrowth = computed<number | null>(() => this.activeMetrics()?.expected_return ?? this.activeVariant().targetGrowth);

  /** Benefits shown, one at a time, while the fund data loads — so the wait
   *  feels useful and the screen never looks like a blank spinner. */
  readonly benefits: { icon: string; title: string; body: string }[] = [
    { icon: 'growth', title: 'Own land, minus the paperwork',
      body: 'No registration runs, no broker, no encroachment risk — your ₹10L is a curated basket of India\'s steadiest growth funds.' },
    { icon: 'shield', title: 'Diversified, not one bet',
      body: 'Three funds move together so a bad year in one is cushioned by the others — a smoother ride than any single fund.' },
    { icon: 'liquid', title: 'Liquid when you need it',
      body: 'Unlike a physical plot that can take months to sell, you can redeem in a few working days — no buyer to find.' },
    { icon: 'clock', title: 'Built to compound',
      body: 'Capital appreciation only — every rupee stays invested and grows, tested across real market cycles.' },
    { icon: 'eye', title: 'Fully transparent',
      body: 'Real NAV history, real drawdowns, real ratios — you\'ll see exactly how this mix behaved, no glossy promises.' },
  ];
  benefitIdx = signal(0);
  private benefitTimer: any = null;

  /** Total growth of ₹10,000 over the whole measured history, for the summary. */
  totalGrowthPct = computed<number | null>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return null;
    const first = m.growth[0].value, last = m.growth[m.growth.length - 1].value;
    return first > 0 ? (last / first - 1) * 100 : null;
  });

  /** Dropdown options for the chart: the blend + each fund of the active variant. */
  chartSources = computed<ChartSource[]>(() => {
    const opts: ChartSource[] = [{ id: 'blend', label: 'Combined basket' }];
    for (const leg of this.activeVariant().legs) {
      opts.push({ id: String(leg.scheme_code), label: leg.label });
    }
    return opts;
  });

  /** Metrics currently feeding the chart (blend or the picked single fund). */
  chartMetrics = computed<BasketMetrics | null>(() => {
    const src = this.chartSource();
    if (src === 'blend') return this.activeMetrics();
    return this.fundMetrics()[Number(src)] ?? null;
  });

  /** The chart series sliced to the selected time range (last N months). */
  windowedGrowth = computed(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return [];
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 36;
    const pts = m.growth;
    // +1 so a 36-month window spans 36 intervals (37 monthly points).
    const start = Math.max(0, pts.length - (months + 1));
    return pts.slice(start);
  });

  /** ₹10,000 rebased to the START of the selected window → value now, and the
   *  % move over that window. Keeps the readout honest to the chosen range. */
  windowReadout = computed<{ from: number; to: number; pct: number; startDate: string } | null>(() => {
    const w = this.windowedGrowth();
    if (w.length < 2) return null;
    // Base the readout on the ACTUAL amount invested (the ticket price), not a
    // generic ₹10,000 — so it reads "₹10,00,000 → ₹14,00,000".
    const base = this.amount();
    const first = w[0].value, last = w[w.length - 1].value;
    if (first <= 0) return null;
    const to = base * (last / first);
    return { from: base, to, pct: (last / first - 1) * 100, startDate: w[0].date };
  });

  /** Annualised return (CAGR) over the selected window — the headline number.
   *  For the combined basket at 3Y/5Y we quote the SAME frozen REAL_METRICS the
   *  storefront tile shows, so the tile and this page never disagree. Single
   *  funds and 1Y/2Y windows fall back to the live computed CAGR. */
  windowCagr = computed<number | null>(() => {
    if (this.chartSource() === 'blend') {
      const v = this.active();
      if (this.chartRange() === '3y') return past3y('land', v);
      if (this.chartRange() === '5y') return past5y('land', v);
    }
    const w = this.windowedGrowth();
    if (w.length < 2) return null;
    const first = w[0].value, last = w[w.length - 1].value;
    if (first <= 0) return null;
    const years = (w.length - 1) / 12;
    if (years <= 0) return null;
    return (Math.pow(last / first, 1 / years) - 1) * 100;
  });
  windowYears = computed<number>(() => Math.max(1, Math.round((this.windowedGrowth().length - 1) / 12)));

  /** The jargon readout stays hidden until tapped. */
  ppInfoOpen = signal(false);
  togglePpInfo(): void { this.ppInfoOpen.update(v => !v); }

  ngOnInit(): void {
    this.active.set(this.initialVariant);
    this.startBenefits();
    this.loadAll();
  }

  ngOnDestroy(): void { this.stopBenefits(); }

  /** Rotate the benefit cards every ~2.6s while loading. */
  private startBenefits(): void {
    this.stopBenefits();
    this.benefitTimer = setInterval(() => {
      this.benefitIdx.update(i => (i + 1) % this.benefits.length);
    }, 1900);
  }
  private stopBenefits(): void {
    if (this.benefitTimer) { clearInterval(this.benefitTimer); this.benefitTimer = null; }
  }

  /** Minimum time the loading screen stays up, so the animation plays fully and
   *  the user can read the message — no snapping to the page even if data is fast. */
  private readonly MIN_LOAD_MS = 3000;
  private loadStart = 0;

  /** Flip loading off, but never before MIN_LOAD_MS has elapsed. */
  private finishLoading(errMsg?: string): void {
    const elapsed = Date.now() - this.loadStart;
    const wait = Math.max(0, this.MIN_LOAD_MS - elapsed);
    setTimeout(() => {
      if (errMsg) this.error.set(errMsg);
      this.loading.set(false);
      this.stopBenefits();
    }, wait);
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadStart = Date.now();
    let remaining = this.variants.length;
    let anyOk = false;
    for (const v of this.variants) {
      const items = v.legs.map(l => ({ scheme_code: l.scheme_code, weight: l.weight }));
      this.api.analyze(items).subscribe({
        next: m => {
          this.metrics.update(cur => ({ ...cur, [v.key]: m }));
          anyOk = true;
          if (--remaining === 0) this.finishLoading();
        },
        error: () => {
          if (--remaining === 0) {
            this.finishLoading(anyOk ? undefined : 'Could not reach the fund engine. Is the backend running?');
          }
        },
      });
    }
  }

  /** Lazily fetch a single fund's own series the first time it's picked. */
  private ensureFund(code: number): void {
    if (this.fundMetrics()[code]) return;
    this.api.analyze([{ scheme_code: code, weight: 1 }]).subscribe({
      next: m => this.fundMetrics.update(cur => ({ ...cur, [code]: m })),
      error: () => {},
    });
  }

  pickChartSource(id: string): void {
    this.chartSource.set(id);
    if (id !== 'blend') this.ensureFund(Number(id));
  }

  select(k: LandVariantKey): void {
    this.active.set(k);
    this.chartSource.set('blend');   // reset the chart picker to the new blend
  }
  goBack(): void { this.back.emit(); }

  // ── Look-through asset allocation (rolled up to true asset classes) ──────────
  allocation = computed<AllocSlice[]>(() => {
    const legs = this.activeVariant().legs;
    const acc = { equity: 0, debt: 0, gold: 0, cash: 0 };
    for (const l of legs) {
      acc.equity += l.weight * l.look.equity;
      acc.debt += l.weight * l.look.debt;
      acc.gold += l.weight * l.look.gold;
      acc.cash += l.weight * l.look.cash;
    }
    const total = acc.equity + acc.debt + acc.gold + acc.cash || 1;
    const LABELS: Record<AllocSlice['key'], string> = {
      equity: 'Equity', debt: 'Debt', gold: 'Gold', cash: 'Cash / arbitrage',
    };
    return (['equity', 'debt', 'gold', 'cash'] as const)
      .map(k => ({ key: k, label: LABELS[k], pct: (acc[k] / total) * 100 }))
      .filter(s => s.pct >= 0.5);
  });

  // ── Interactive allocation → funds ──────────────────────────────────────────
  /** Which asset class is selected in the split bar. null = show all funds. */
  selectedAsset = signal<AllocSlice['key'] | null>(null);
  /** Which fund row is expanded to show its detail. null = none. */
  expandedFund = signal<number | null>(null);

  selectAsset(key: AllocSlice['key']): void {
    this.selectedAsset.update(cur => (cur === key ? null : key));
    this.expandedFund.set(null);
  }
  toggleFund(code: number): void {
    this.expandedFund.update(cur => (cur === code ? null : code));
  }

  /** Funds shown in the list: all of them, or — when an asset class is picked —
   *  only the funds that hold that class, with the ₹ each puts into it. */
  shownFunds = computed(() => {
    const legs = this.activeVariant().legs;
    const sel = this.selectedAsset();
    const ticket = this.ticketPrice;
    if (!sel) {
      return legs.map(l => ({
        code: l.scheme_code, label: l.label, role: l.role,
        weightPct: l.weight * 100, amount: ticket * l.weight, look: l.look, inAsset: null as number | null,
      }));
    }
    return legs
      .filter(l => l.look[sel] > 0)
      .map(l => ({
        code: l.scheme_code, label: l.label, role: l.role,
        weightPct: l.weight * 100, amount: ticket * l.weight, look: l.look,
        // ₹ this fund contributes to the selected class
        inAsset: ticket * l.weight * l.look[sel],
      }))
      .sort((a, b) => (b.inAsset ?? 0) - (a.inAsset ?? 0));
  });

  /** Per-fund look-through as a small list for the expanded detail. */
  lookRows(look: LookThrough): { key: string; label: string; pct: number }[] {
    const LABELS: Record<string, string> = { equity: 'Equity', debt: 'Debt', gold: 'Gold', cash: 'Cash / arbitrage' };
    return (['equity', 'debt', 'gold', 'cash'] as const)
      .map(k => ({ key: k, label: LABELS[k], pct: look[k] * 100 }))
      .filter(r => r.pct >= 0.5);
  }

  // ── Projection (editable amount, credible band) ─────────────────────────────
  projection = computed<ProjRow[]>(() => {
    const m = this.activeMetrics();
    const amt = this.amount();
    if (!m || !amt || amt <= 0) return [];
    const er = (m.expected_return ?? 11) / 100;
    const vol = (m.volatility ?? 14) / 100;
    return this.horizons.map(y => {
      const mid = amt * Math.pow(1 + er, y);
      const spread = Math.min(vol / Math.sqrt(y), 0.9);
      const low = amt * Math.pow(1 + Math.max(er - spread, -0.15), y);
      const high = amt * Math.pow(1 + er + spread, y);
      return { year: y, low, mid, high };
    });
  });

  finalMultiple = computed<number | null>(() => {
    const rows = this.projection();
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const amt = this.amount();
    return amt > 0 ? last.mid / amt : null;
  });

  // ── "How your money would grow" over N years, for the chosen plots ──────────
  setPlots(n: number): void { this.plots.set(n); }

  readonly agoOptions = [3, 5, 10, 20];
  yearsAgo = signal<number>(20);
  setYearsAgo(n: number): void { this.yearsAgo.set(n); }

  /** The 5-year average annual return we base the projection on (real data). */
  avgGrowthPct = computed<number>(() => {
    const m = this.activeMetrics();
    if (!m) return 11;
    return m.return_5y ?? m.return_3y ?? m.expected_return ?? 11;
  });
  private avgGrowthRate(): number { return this.avgGrowthPct() / 100; }

  /** Year-by-year path of the invested amount (plots × ticket) compounded at
   *  the 5-yr average rate, up to today — for the stacked bars. */
  pastProjection = computed<{ year: number; value: number }[]>(() => {
    const amt = this.amount();
    const rate = this.avgGrowthRate();
    const years = this.yearsAgo();
    const out: { year: number; value: number }[] = [];
    const steps = Math.min(years, 5);
    for (let s = 0; s <= steps; s++) {
      const y = Math.round((s / steps) * years);
      out.push({ year: y, value: amt * Math.pow(1 + rate, y) });
    }
    return out;
  });

  pastNowValue = computed<number>(() => {
    const rows = this.pastProjection();
    return rows.length ? rows[rows.length - 1].value : this.amount();
  });
  pastMultiple = computed<number>(() => this.pastNowValue() / this.amount());

  // ── SVG geometry for the growth curve (with real X/Y axes + hover) ──────────
  readonly chartW = 680;
  readonly chartH = 260;
  readonly padL = 58;   // room for the ₹ Y-axis labels
  readonly padR = 10;
  readonly padT = 12;
  readonly padB = 30;   // room for the year X-axis labels

  private get plotW() { return this.chartW - this.padL - this.padR; }
  private get plotH() { return this.chartH - this.padT - this.padB; }

  /** Value bounds of the windowed series. */
  private vBounds = computed<{ lo: number; hi: number } | null>(() => {
    const w = this.windowedGrowth();
    if (!w.length) return null;
    const vals = w.map(g => g.value);
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
  });

  private xAt(i: number, n: number): number {
    return this.padL + (n <= 1 ? 0 : (i / (n - 1)) * this.plotW);
  }
  private yAt(v: number, lo: number, hi: number): number {
    const span = hi - lo || 1;
    return this.padT + (1 - (v - lo) / span) * this.plotH;
  }

  growthPath = computed<string>(() => {
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (!w.length || !b) return '';
    return w.map((g, i) =>
      `${i === 0 ? 'M' : 'L'}${this.xAt(i, w.length).toFixed(1)} ${this.yAt(g.value, b.lo, b.hi).toFixed(1)}`
    ).join(' ');
  });

  growthArea = computed<string>(() => {
    const line = this.growthPath();
    const w = this.windowedGrowth();
    if (!line || !w.length) return '';
    const baseY = this.chartH - this.padB;
    const lastX = this.xAt(w.length - 1, w.length);
    return `${line} L${lastX.toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  });

  /** Y-axis ticks: 4 evenly spaced ₹ amounts — labelled in the INVESTOR's money
   *  (their invested amount grown), not the raw fund NAV, so ₹10L reads as ₹10L. */
  yTicks = computed<{ y: number; label: string }[]>(() => {
    const b = this.vBounds();
    const w = this.windowedGrowth();
    if (!b || !w.length) return [];
    const start = w[0].value || 1;          // NAV at the window start
    const invested = this.amount();          // what the customer put in
    const n = 4;
    const out: { y: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const v = b.lo + (i / n) * (b.hi - b.lo);      // raw NAV at this gridline
      const worth = invested * (v / start);          // → investor rupees
      out.push({ y: this.yAt(v, b.lo, b.hi), label: this.compact(worth) });
    }
    return out;
  });

  /** X-axis ticks: ~5 dates spread across the windowed series (Y-M for short ranges). */
  xTicks = computed<{ x: number; label: string }[]>(() => {
    const w = this.windowedGrowth();
    if (!w.length) return [];
    const n = w.length;
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 36;
    const shortRange = months <= 24;
    const count = Math.min(5, n);
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * (n - 1));
      const d = w[idx].date || '';
      // short ranges show "Mon 'YY", longer ranges just the year
      out.push({ x: this.xAt(idx, n), label: shortRange ? this.monLabel(d) : d.slice(0, 4) });
    }
    return out;
  });

  private monLabel(ym: string): string {
    const [y, mo] = ym.split('-');
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return mo ? `${MON[+mo] || ''} '${(y || '').slice(2)}` : (y || '');
  }

  growthEndpoints = computed(() => {
    const w = this.windowedGrowth();
    if (!w.length) return null;
    const first = w[0], last = w[w.length - 1];
    return { startVal: first.value, endVal: last.value, startDate: first.date, endDate: last.date };
  });

  chartLoading = computed<boolean>(() => this.chartSource() !== 'blend' && !this.chartMetrics());

  // ── Hover ────────────────────────────────────────────────────────────────────
  hoverIdx = signal<number | null>(null);

  onChartMove(ev: MouseEvent): void {
    const svg = (ev.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const w = this.windowedGrowth();
    if (!w.length || rect.width === 0) return;
    const xView = ((ev.clientX - rect.left) / rect.width) * this.chartW;
    const frac = Math.max(0, Math.min(1, (xView - this.padL) / this.plotW));
    this.hoverIdx.set(Math.round(frac * (w.length - 1)));
  }
  onChartLeave(): void { this.hoverIdx.set(null); }

  hover = computed(() => {
    const i = this.hoverIdx();
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (i == null || !w.length || !b || !w[i]) return null;
    const g = w[i];
    const x = this.xAt(i, w.length);
    const y = this.yAt(g.value, b.lo, b.hi);
    const base = w[0]?.value ?? g.value;   // % vs the window's own start
    const growthPct = base > 0 ? (g.value / base - 1) * 100 : 0;
    // The investor's money: the amount they'd invest (ticket) grown to this
    // point, so the tip shows real rupees, not a raw NAV.
    const invested = this.amount();
    const worth = base > 0 ? invested * (g.value / base) : invested;
    return { x, y, value: g.value, invested, worth, date: g.date, growthPct, drawdown: g.drawdown };
  });

  projMax = computed<number>(() => {
    const rows = this.projection();
    return rows.length ? Math.max(...rows.map(r => r.high)) : 1;
  });

  barHeight(v: number): number {
    const max = this.projMax();
    return max > 0 ? (v / max) * 100 : 0;
  }

  // ── Formatting ──────────────────────────────────────────────────────────────
  inr(v: number | null | undefined): string {
    if (v == null) return '—';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }

  compact(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v >= 1_00_00_000) {
      const cr = v / 1_00_00_000;
      return '₹' + (cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')) + 'Cr';
    }
    if (v >= 1_00_000) {
      const l = v / 1_00_000;
      return '₹' + (l % 1 === 0 ? l : l.toFixed(2).replace(/\.?0+$/, '')) + 'L';
    }
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }

  pct(v: number | null | undefined, dp = 1): string {
    if (v == null) return '—';
    return v.toFixed(dp) + '%';
  }

  sharpe(m: BasketMetrics | null): number | null {
    if (!m || m.expected_return == null || !m.volatility) return null;
    return (m.expected_return - 6.5) / m.volatility;
  }

  beta(m: BasketMetrics | null): number | null {
    if (!m) return null;
    const eq = m.asset_mix?.['equity'] ?? 0;
    const hyb = m.asset_mix?.['hybrid'] ?? 0;
    return (eq * 1.0 + hyb * 0.55) / 100;
  }

  /** The plot choices offered: buy 1, 2 or 3 plots. */
  readonly plotOptions = [1, 2, 3];
}
