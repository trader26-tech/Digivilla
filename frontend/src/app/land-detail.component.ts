import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BasketMetrics, LandDetailService } from './land-detail.service';
import { schemeName, schemeLocality } from './property-package.data';

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
      { scheme_code: 147704, label: 'Motilal Oswal Large and Midcap', weight: 0.35, role: 'A midcap tilt for the extra growth',
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
  imports: [CommonModule, FormsModule],
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

  activeVariant = computed(() => this.variants.find(v => v.key === this.active())!);
  activeMetrics = computed<BasketMetrics | null>(() => this.metrics()[this.active()] ?? null);

  /** The plot's name EXACTLY as the tapped tile shows it: "<scheme> Land". */
  plotName = computed(() => `${schemeName('land', this.active())} Land`);
  plotLocality = computed(() => schemeLocality('land', this.active()));

  /** Hero growth ratios are hidden until tapped. */
  heroDetailsOpen = signal(false);
  toggleHeroDetails(): void { this.heroDetailsOpen.update(v => !v); }

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
    }, 2600);
  }
  private stopBenefits(): void {
    if (this.benefitTimer) { clearInterval(this.benefitTimer); this.benefitTimer = null; }
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    let remaining = this.variants.length;
    let anyOk = false;
    for (const v of this.variants) {
      const items = v.legs.map(l => ({ scheme_code: l.scheme_code, weight: l.weight }));
      this.api.analyze(items).subscribe({
        next: m => {
          this.metrics.update(cur => ({ ...cur, [v.key]: m }));
          anyOk = true;
          if (--remaining === 0) { this.loading.set(false); this.stopBenefits(); }
        },
        error: () => {
          if (--remaining === 0) {
            this.loading.set(false);
            this.stopBenefits();
            if (!anyOk) this.error.set('Could not reach the fund engine. Is the backend running?');
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

  // ── SVG geometry for the growth curve (with real X/Y axes + hover) ──────────
  readonly chartW = 680;
  readonly chartH = 260;
  readonly padL = 58;   // room for the ₹ Y-axis labels
  readonly padR = 10;
  readonly padT = 12;
  readonly padB = 30;   // room for the year X-axis labels

  private get plotW() { return this.chartW - this.padL - this.padR; }
  private get plotH() { return this.chartH - this.padT - this.padB; }

  /** Value bounds of the current series, padded a touch at the top. */
  private vBounds = computed<{ lo: number; hi: number } | null>(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return null;
    const vals = m.growth.map(g => g.value);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { lo: Math.min(lo, 0) === lo ? lo : lo, hi };
  });

  private xAt(i: number, n: number): number {
    return this.padL + (n <= 1 ? 0 : (i / (n - 1)) * this.plotW);
  }
  private yAt(v: number, lo: number, hi: number): number {
    const span = hi - lo || 1;
    return this.padT + (1 - (v - lo) / span) * this.plotH;
  }

  growthPath = computed<string>(() => {
    const m = this.chartMetrics(); const b = this.vBounds();
    if (!m || !b) return '';
    return m.growth.map((g, i) =>
      `${i === 0 ? 'M' : 'L'}${this.xAt(i, m.growth.length).toFixed(1)} ${this.yAt(g.value, b.lo, b.hi).toFixed(1)}`
    ).join(' ');
  });

  growthArea = computed<string>(() => {
    const line = this.growthPath();
    const m = this.chartMetrics();
    if (!line || !m) return '';
    const baseY = this.chartH - this.padB;
    const lastX = this.xAt(m.growth.length - 1, m.growth.length);
    return `${line} L${lastX.toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  });

  drawdownPath = computed<string>(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return '';
    const dds = m.growth.map(g => g.drawdown);
    const lo = Math.min(...dds), hi = Math.max(...dds, 0);
    const span = hi - lo || 1;
    // small strip 46 tall, 0 at top
    return m.growth.map((g, i) => {
      const x = this.xAt(i, m.growth.length);
      const y = ((hi - g.drawdown) / span) * 46;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  });

  /** Y-axis ticks: 4 evenly spaced ₹ amounts. */
  yTicks = computed<{ y: number; label: string }[]>(() => {
    const b = this.vBounds();
    if (!b) return [];
    const n = 4;
    const out: { y: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const v = b.lo + (i / n) * (b.hi - b.lo);
      out.push({ y: this.yAt(v, b.lo, b.hi), label: this.compact(v) });
    }
    return out;
  });

  /** X-axis ticks: ~5 dates spread across the series. */
  xTicks = computed<{ x: number; label: string }[]>(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return [];
    const n = m.growth.length;
    const count = Math.min(5, n);
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * (n - 1));
      out.push({ x: this.xAt(idx, n), label: (m.growth[idx].date || '').slice(0, 4) });
    }
    return out;
  });

  growthEndpoints = computed(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return null;
    const first = m.growth[0], last = m.growth[m.growth.length - 1];
    return { startVal: first.value, endVal: last.value, startDate: first.date, endDate: last.date };
  });

  chartLoading = computed<boolean>(() => this.chartSource() !== 'blend' && !this.chartMetrics());

  // ── Hover ────────────────────────────────────────────────────────────────────
  hoverIdx = signal<number | null>(null);

  /** Resolve the mouse x (in the SVG's own viewBox units) to the nearest point. */
  onChartMove(ev: MouseEvent): void {
    const svg = (ev.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    const m = this.chartMetrics();
    if (!m || !m.growth.length || rect.width === 0) return;
    const xView = ((ev.clientX - rect.left) / rect.width) * this.chartW;
    const frac = Math.max(0, Math.min(1, (xView - this.padL) / this.plotW));
    this.hoverIdx.set(Math.round(frac * (m.growth.length - 1)));
  }
  onChartLeave(): void { this.hoverIdx.set(null); }

  /** The hovered point, with its screen coords + values for the tooltip. */
  hover = computed(() => {
    const i = this.hoverIdx();
    const m = this.chartMetrics(); const b = this.vBounds();
    if (i == null || !m || !b || !m.growth[i]) return null;
    const g = m.growth[i];
    const x = this.xAt(i, m.growth.length);
    const y = this.yAt(g.value, b.lo, b.hi);
    const base = m.base_investment || (m.growth[0]?.value ?? 10000);
    const growthPct = base > 0 ? (g.value / base - 1) * 100 : 0;
    return { x, y, value: g.value, date: g.date, growthPct, drawdown: g.drawdown };
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
      return '₹' + (l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')) + 'L';
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
  setPlots(n: number): void { this.plots.set(n); }
}
