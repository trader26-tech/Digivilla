import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BasketMetrics, LandDetailService } from './land-detail.service';

export type LandVariantKey = 'conservative' | 'balanced' | 'aggressive';

/** One fund leg of a land basket — display label plus the AMFI scheme code we
 *  actually analyse (a couple of labels map to the closest available scheme). */
interface Leg {
  scheme_code: number;
  label: string;   // the name the customer sees
  weight: number;  // 0..1
  role: string;    // one-line "why it's here"
}

interface LandVariant {
  key: LandVariantKey;
  label: string;
  blurb: string;         // one-line positioning
  accent: string;        // css var for the risk tone
  targetGrowth: number;  // headline "expected growth" the storefront advertises
  legs: Leg[];
}

/** A point plotted on the projection chart (value of the lump sum at year Y). */
interface ProjRow {
  year: number;
  low: number;
  mid: number;
  high: number;
}

/** The land baskets, with the EXACT allocations the desk publishes. Capital
 *  appreciation only — there is NO rental income on land. */
const VARIANTS: LandVariant[] = [
  {
    key: 'conservative',
    label: 'Conservative',
    blurb: 'Steadiest path — a debt-cushioned core that rides out the dips.',
    accent: 'var(--positive)',
    targetGrowth: 10.2,
    legs: [
      { scheme_code: 102330, label: 'ICICI Pru Equity Savings', weight: 0.25, role: 'Hedged equity + debt — low swings, the shock absorber' },
      { scheme_code: 100119, label: 'HDFC Balanced Advantage', weight: 0.40, role: 'Dynamically shifts equity↔debt to cushion drawdowns' },
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.35, role: 'Diversified growth engine across large/mid/global' },
    ],
  },
  {
    key: 'balanced',
    label: 'Balanced',
    blurb: 'The all-weather middle — real growth, without a stomach-churning ride.',
    accent: 'var(--brass)',
    targetGrowth: 11.8,
    legs: [
      { scheme_code: 100119, label: 'HDFC Balanced Advantage', weight: 0.20, role: 'The debt cushion that tames the swings' },
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.45, role: 'Core diversified compounder' },
      { scheme_code: 147704, label: 'Motilal Oswal Large and Midcap', weight: 0.35, role: 'A midcap tilt for the extra growth' },
    ],
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    blurb: 'Built to appreciate — maximum compounding for the long horizon.',
    accent: 'var(--terracotta)',
    targetGrowth: 12.9,
    legs: [
      { scheme_code: 122640, label: 'Parag Parikh Flexi Cap', weight: 0.40, role: 'A diversified anchor under the higher-beta legs' },
      { scheme_code: 105758, label: 'HDFC Mid-Cap Opportunities', weight: 0.35, role: 'The midcap growth core' },
      { scheme_code: 113177, label: 'Nippon India Small Cap', weight: 0.25, role: 'Small-cap kicker — highest potential, highest swings' },
    ],
  },
];

/** Horizons shown on the "what ₹X becomes" chart. */
const HORIZONS = [1, 3, 5, 10, 20];

@Component({
  selector: 'app-land-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './land-detail.component.html',
  styleUrl: './land-detail.component.scss',
})
export class LandDetailComponent implements OnInit {
  @Output() back = new EventEmitter<void>();

  private api = inject(LandDetailService);

  readonly variants = VARIANTS;
  readonly horizons = HORIZONS;
  readonly ticketPrice = 10_00_000;

  /** Which variant the customer is viewing. */
  active = signal<LandVariantKey>('balanced');

  /** Editable lump sum for the projection chart (defaults to the ₹10L ticket). */
  amount = signal<number>(this.ticketPrice);

  /** Real metrics per variant, keyed by variant key. */
  metrics = signal<Record<string, BasketMetrics>>({});
  loading = signal(true);
  error = signal<string | null>(null);

  activeVariant = computed(() => this.variants.find(v => v.key === this.active())!);
  activeMetrics = computed<BasketMetrics | null>(() => this.metrics()[this.active()] ?? null);

  ngOnInit(): void {
    this.loadAll();
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
          if (--remaining === 0) this.loading.set(false);
        },
        error: () => {
          if (--remaining === 0) {
            this.loading.set(false);
            if (!anyOk) this.error.set('Could not reach the fund engine. Is the backend running?');
          }
        },
      });
    }
  }

  select(k: LandVariantKey): void { this.active.set(k); }
  goBack(): void { this.back.emit(); }

  // ── Projection: scale the amount, extend to each horizon deterministically ──
  /** Median compound value + a 1-sigma-ish band, per horizon, for the entered
   *  amount. Uses the basket's own expected return & volatility (from real NAV
   *  history), so the band widens correctly with the risk of the mix. */
  projection = computed<ProjRow[]>(() => {
    const m = this.activeMetrics();
    const amt = this.amount();
    if (!m || !amt || amt <= 0) return [];
    const er = (m.expected_return ?? 11) / 100;
    const vol = (m.volatility ?? 14) / 100;
    return this.horizons.map(y => {
      const mid = amt * Math.pow(1 + er, y);
      // 1-sigma-ish band on the compound outcome, scaled by √time (random walk).
      const spread = vol * Math.sqrt(y);
      const low = amt * Math.pow(1 + Math.max(er - spread, -0.6), y);
      const high = amt * Math.pow(1 + er + spread, y);
      return { year: y, low, mid, high };
    });
  });

  /** The 20-year median multiple, for the headline "grows to ~Nx". */
  finalMultiple = computed<number | null>(() => {
    const rows = this.projection();
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const amt = this.amount();
    return amt > 0 ? last.mid / amt : null;
  });

  // ── SVG geometry for the historical growth curve (the ₹10k → today line) ────
  readonly chartW = 680;
  readonly chartH = 240;
  readonly padL = 8;
  readonly padR = 8;
  readonly padT = 12;
  readonly padB = 22;

  /** The historical growth curve as an SVG path 'd', normalised to the box. */
  growthPath = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    return this.pathFrom(m.growth.map(g => g.value));
  });

  /** Matching area fill under the growth curve. */
  growthArea = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    return this.areaFrom(m.growth.map(g => g.value));
  });

  /** The drawdown (underwater) curve — how far below peak, over time. */
  drawdownPath = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    // drawdown is <= 0; plot magnitude so deeper = lower.
    return this.pathFrom(m.growth.map(g => g.drawdown), true);
  });

  /** Start/end value labels on the growth curve. */
  growthEndpoints = computed(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return null;
    const first = m.growth[0], last = m.growth[m.growth.length - 1];
    return { startVal: first.value, endVal: last.value, startDate: first.date, endDate: last.date };
  });

  private pathFrom(vals: number[], invert = false): string {
    if (vals.length < 2) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    const w = this.chartW - this.padL - this.padR;
    const h = this.chartH - this.padT - this.padB;
    return vals.map((v, i) => {
      const x = this.padL + (i / (vals.length - 1)) * w;
      const t = (v - lo) / span;             // 0..1
      const y = invert
        ? this.padT + t * h                  // for drawdown: 0 (top) = no dd
        : this.padT + (1 - t) * h;           // growth: high value = top
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  private areaFrom(vals: number[]): string {
    const line = this.pathFrom(vals);
    if (!line) return '';
    const w = this.chartW - this.padR;
    const baseY = this.chartH - this.padB;
    return `${line} L${w.toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  }

  // ── Projection chart geometry (bar-style, editable amount) ──────────────────
  projMax = computed<number>(() => {
    const rows = this.projection();
    return rows.length ? Math.max(...rows.map(r => r.high)) : 1;
  });

  barHeight(v: number): number {
    const max = this.projMax();
    return max > 0 ? (v / max) * 100 : 0;
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────
  /** Indian-format rupees: ₹25,00,000. */
  inr(v: number | null | undefined): string {
    if (v == null) return '—';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }

  /** Compact: ₹10L, ₹1.4Cr. */
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

  /** Sharpe-style ratio from a basket's own return & vol (risk-free 6.5%). */
  sharpe(m: BasketMetrics | null): number | null {
    if (!m || m.expected_return == null || !m.volatility) return null;
    return (m.expected_return - 6.5) / m.volatility;
  }

  /** Beta proxy: equity-weight-scaled — a mix that is 80% equity carries ~0.8
   *  of broad-market swings. Honest, category-based, no external index feed. */
  beta(m: BasketMetrics | null): number | null {
    if (!m) return null;
    const eq = m.asset_mix?.['equity'] ?? 0;
    const hyb = m.asset_mix?.['hybrid'] ?? 0;
    // hybrid funds carry ~0.55 equity beta; pure equity ~1.0.
    return (eq * 1.0 + hyb * 0.55) / 100;
  }

  assetMixEntries(m: BasketMetrics | null): { label: string; pct: number }[] {
    if (!m || !m.asset_mix) return [];
    const LABELS: Record<string, string> = { equity: 'Equity', hybrid: 'Hybrid', debt: 'Debt', gold: 'Gold' };
    return Object.entries(m.asset_mix)
      .map(([k, v]) => ({ label: LABELS[k] ?? k, pct: v }))
      .sort((a, b) => b.pct - a.pct);
  }

  amountFromInput(v: string): void {
    const n = Number(v.replace(/[^0-9]/g, ''));
    this.amount.set(isNaN(n) ? 0 : n);
  }

  presetAmounts = [5_00_000, 10_00_000, 25_00_000, 50_00_000];
}
