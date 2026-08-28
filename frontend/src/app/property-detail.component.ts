import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Leg,
  LegRole,
  PACKAGES,
  PropertyKey,
  ROLE_LABEL,
  TAX_NOTE,
  Variant,
  VariantKey,
  VARIANT_ORDER,
  WITHDRAWAL_RULES,
  runwayMonths,
  totalMonthlyIncome,
} from './property-package.data';
import { BasketMetrics, ProjPoint, PropertyDetailService } from './property-detail.service';

/** A point on the fan chart, in chart pixels. */
interface FanBand {
  year: number;
  p5: number; p25: number; p50: number; p75: number; p95: number;
}

@Component({
  selector: 'app-property-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './property-detail.component.html',
  styleUrl: './property-detail.component.scss',
})
export class PropertyDetailComponent implements OnInit {
  /** Which tier to show (set by the storefront tile that was tapped). */
  @Input() property: PropertyKey = 'flat';
  /** Which risk variant to open on. */
  @Input() initialVariant: VariantKey = 'balanced';
  @Output() back = new EventEmitter<void>();

  private api = inject(PropertyDetailService);

  readonly variantOrder = VARIANT_ORDER;
  readonly roleLabel = ROLE_LABEL;
  readonly withdrawalRules = WITHDRAWAL_RULES;
  readonly taxNote = TAX_NOTE;

  /** The package for the tier we're showing. */
  pkg = computed(() => PACKAGES[this.property]);
  get incomePays(): boolean { return this.pkg().incomePays; }
  get ticketPrice(): number { return this.pkg().price; }

  active = signal<VariantKey>('balanced');
  amount = signal<number>(0);

  metrics = signal<Record<string, BasketMetrics>>({});
  loading = signal(true);
  error = signal<string | null>(null);

  activeVariant = computed<Variant>(() => this.pkg().variants[this.active()]);
  activeMetrics = computed<BasketMetrics | null>(() => this.metrics()[this.active()] ?? null);

  ngOnInit(): void {
    this.active.set(this.initialVariant);
    this.amount.set(this.ticketPrice);
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    const variants = this.variantOrder.map(k => this.pkg().variants[k]);
    let remaining = variants.length;
    let anyOk = false;
    for (const v of variants) {
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

  select(k: VariantKey): void { this.active.set(k); }
  goBack(): void { this.back.emit(); }

  // ── Bucket mechanics ────────────────────────────────────────────────────────
  legsByRole(role: LegRole): Leg[] {
    return this.activeVariant().legs.filter(l => l.role === role);
  }
  hasRole(role: LegRole): boolean { return this.legsByRole(role).length > 0; }

  /** Total monthly income actually drawn (sum of the SWP legs). */
  monthlyIncome = computed<number>(() => totalMonthlyIncome(this.activeVariant()));

  /** The income sleeve's corpus (₹) — arbitrage/equity-savings weight × ticket. */
  incomeCorpus = computed<number>(() =>
    this.activeVariant().legs
      .filter(l => l.role === 'income')
      .reduce((s, l) => s + l.weight * this.ticketPrice, 0)
  );

  /** How many months of rent the income sleeve can cover — the runway. */
  runway = computed<number>(() => runwayMonths(this.activeVariant(), this.ticketPrice));
  /** Runway meter fill, capped at the 24-month "healthy" target. */
  runwayPct = computed<number>(() => Math.min(100, (this.runway() / 24) * 100));

  /** Growth corpus (₹) that refills the income sleeve annually. */
  growthCorpus = computed<number>(() =>
    this.activeVariant().legs
      .filter(l => l.role === 'growth')
      .reduce((s, l) => s + l.weight * this.ticketPrice, 0)
  );
  liquidCorpus = computed<number>(() =>
    this.activeVariant().legs
      .filter(l => l.role === 'liquid')
      .reduce((s, l) => s + l.weight * this.ticketPrice, 0)
  );

  // ── Monte Carlo fan geometry ────────────────────────────────────────────────
  readonly fanW = 680;
  readonly fanH = 260;
  readonly fanPadL = 6;
  readonly fanPadR = 6;
  readonly fanPadT = 10;
  readonly fanPadB = 24;

  private proj = computed(() => this.activeMetrics()?.projection ?? null);
  hasMonteCarlo = computed<boolean>(() => {
    const p = this.proj();
    return !!p && !!p.points?.length && p.points.some(pt => pt.p95 != null);
  });

  /** Scale factor from the engine's ₹10k base to the customer's entered amount. */
  private amtScale = computed<number>(() => {
    const p = this.proj();
    const amt = this.amount();
    if (!p || !p.base || !amt) return 1;
    return amt / p.base;
  });

  /** The percentile fan as pixel bands, ready to plot. */
  fanBands = computed<FanBand[]>(() => {
    const p = this.proj();
    if (!p || !p.points?.length) return [];
    const pts = p.points;
    const scale = this.amtScale();
    const maxV = Math.max(...pts.map(pt => (pt.p95 ?? pt.p90) * scale));
    const w = this.fanW - this.fanPadL - this.fanPadR;
    const h = this.fanH - this.fanPadT - this.fanPadB;
    const yrs = pts[pts.length - 1].year || 1;
    const x = (yr: number) => this.fanPadL + (yr / yrs) * w;
    const y = (v: number) => this.fanPadT + (1 - (v * scale) / (maxV || 1)) * h;
    return pts.map(pt => ({
      year: pt.year,
      p5: y(pt.p5 ?? pt.p10), p25: y(pt.p25 ?? pt.p10), p50: y(pt.p50),
      p75: y(pt.p75 ?? pt.p90), p95: y(pt.p95 ?? pt.p90),
    }));
  });

  /** Build a filled band path between two percentile series (top → bottom). */
  private bandPath(sel: (b: FanBand) => number, sel2: (b: FanBand) => number): string {
    const bands = this.fanBands();
    if (!bands.length) return '';
    const yrs = bands[bands.length - 1].year || 1;
    const w = this.fanW - this.fanPadL - this.fanPadR;
    const x = (yr: number) => this.fanPadL + (yr / yrs) * w;
    const top = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.year).toFixed(1)} ${sel(b).toFixed(1)}`).join(' ');
    const bot = [...bands].reverse().map(b => `L${x(b.year).toFixed(1)} ${sel2(b).toFixed(1)}`).join(' ');
    return `${top} ${bot} Z`;
  }
  outerBand = computed(() => this.bandPath(b => b.p95, b => b.p5));
  innerBand = computed(() => this.bandPath(b => b.p75, b => b.p25));
  medianLine = computed<string>(() => {
    const bands = this.fanBands();
    if (!bands.length) return '';
    const yrs = bands[bands.length - 1].year || 1;
    const w = this.fanW - this.fanPadL - this.fanPadR;
    const x = (yr: number) => this.fanPadL + (yr / yrs) * w;
    return bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.year).toFixed(1)} ${b.p50.toFixed(1)}`).join(' ');
  });

  /** A handful of raw simulated paths (normalised base=100) as SVG polylines. */
  samplePaths = computed<string[]>(() => {
    const p = this.proj();
    if (!p?.sample_paths?.length) return [];
    const scale = this.amtScale();
    // paths are in base=100 units; convert to the customer's amount then to px.
    const amt = this.amount() || p.base;
    const maxV = Math.max(...this.fanBands().map(() => 0), ...p.points.map(pt => (pt.p95 ?? pt.p90) * scale)) || 1;
    const w = this.fanW - this.fanPadL - this.fanPadR;
    const h = this.fanH - this.fanPadT - this.fanPadB;
    const yrs = p.years || 1;
    const x = (yr: number) => this.fanPadL + (yr / yrs) * w;
    const y = (unit100: number) => {
      const v = (unit100 / 100) * amt;
      return this.fanPadT + (1 - v / maxV) * h;
    };
    return p.sample_paths.map(path =>
      path.map((u, i) => `${x(i).toFixed(1)},${y(u).toFixed(1)}`).join(' ')
    );
  });

  /** The Monte Carlo "how probable" numbers, scaled to the entered amount. */
  mc = computed(() => {
    const p = this.proj();
    if (!p) return null;
    const scale = this.amtScale();
    return {
      sims: p.sims ?? 0,
      years: p.years,
      probGain: p.prob_gain ?? null,
      probDouble: p.prob_double ?? null,
      multiple: p.expected_multiple ?? null,
      finalP10: p.final_p10 * scale,
      finalP50: p.final_p50 * scale,
      finalP90: p.final_p90 * scale,
    };
  });

  // ── Historical growth curve (real NAV) ──────────────────────────────────────
  readonly chartW = 680;
  readonly chartH = 200;
  readonly padL = 6;
  readonly padR = 6;
  readonly padT = 10;
  readonly padB = 20;

  growthPath = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    return this.pathFrom(m.growth.map(g => g.value));
  });
  growthArea = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    return this.areaFrom(m.growth.map(g => g.value));
  });
  drawdownPath = computed<string>(() => {
    const m = this.activeMetrics();
    if (!m || !m.growth.length) return '';
    return this.pathFrom(m.growth.map(g => g.drawdown), true);
  });
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
      const t = (v - lo) / span;
      const y = invert ? this.padT + t * h : this.padT + (1 - t) * h;
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

  // ── Derived metrics helpers ─────────────────────────────────────────────────
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
  assetMixEntries(m: BasketMetrics | null): { label: string; pct: number }[] {
    if (!m || !m.asset_mix) return [];
    const LABELS: Record<string, string> = { equity: 'Equity', hybrid: 'Hybrid', debt: 'Debt', gold: 'Gold' };
    return Object.entries(m.asset_mix)
      .map(([k, v]) => ({ label: LABELS[k] ?? k, pct: v }))
      .sort((a, b) => b.pct - a.pct);
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
  roleClass(role: LegRole): string { return role; }

  amountFromInput(v: string): void {
    const n = Number(v.replace(/[^0-9]/g, ''));
    this.amount.set(isNaN(n) ? 0 : n);
  }
  presetAmounts = [10_00_000, 25_00_000, 50_00_000, 99_00_000];
}
