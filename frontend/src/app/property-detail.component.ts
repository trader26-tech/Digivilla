import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ALL_SCHEMES,
  Leg,
  LegRole,
  PACKAGES,
  PropertyKey,
  RISK_SHORT,
  ROLE_LABEL,
  TAX_NOTE,
  Variant,
  VariantKey,
  VARIANT_ORDER,
  WITHDRAWAL_RULES,
  runwayMonths,
  schemeLocality,
  schemeName,
  totalMonthlyIncome,
} from './property-package.data';
import { BasketMetrics, ProjPoint, PropertyDetailService } from './property-detail.service';

/** A point on the fan chart, in chart pixels. */
interface FanBand {
  year: number;
  p5: number; p25: number; p50: number; p75: number; p95: number;
}

/** One pin on the risk–reward map. */
interface MapPin {
  property: PropertyKey;
  variant: VariantKey;
  name: string;
  locality: string;
  risk: number;      // 0..1 (x)
  reward: number;    // 0..1 (y)
  cx: number;        // px
  cy: number;        // px
  isCurrent: boolean;
  isSelf: boolean;   // same property (dev), any variant
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
  /** Optional deep-link focus: 'map' opens scrolled to the risk–reward map,
   *  self-pin highlighted (used by the storefront tile's location pin). */
  @Input() focus: 'map' | null = null;
  @Output() back = new EventEmitter<void>();

  /** Set while we still owe a scroll-to-map once the data + view are ready. */
  private pendingMapFocus = false;

  private api = inject(PropertyDetailService);

  readonly variantOrder = VARIANT_ORDER;
  readonly roleLabel = ROLE_LABEL;
  /** Short risk word for the tight variant pills. */
  readonly riskShort = RISK_SHORT;
  /** Exposed to the template for the risk–reward map readout. */
  readonly PACKAGES = PACKAGES;
  /** Order the fund roles are grouped/rendered in the breakdown. */
  readonly roleOrder: LegRole[] = ['income', 'growth', 'hedge', 'liquid'];
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

  /** One reassuring line shown while the data loads (single, animated in). */
  loadingMsg = computed<string>(() => {
    const n = this.pkg().name.toLowerCase();
    const one = n === 'land' ? 'plot' : n;
    return `Preparing the best ${one}s for you, at affordable pricing…`;
  });

  ngOnInit(): void {
    this.active.set(this.initialVariant);
    this.amount.set(this.ticketPrice);
    this.pendingMapFocus = this.focus === 'map';
    this.loadAll();
  }

  /** Once the data's in and the map has rendered, honour a pending map focus. */
  private maybeFocusMap(): void {
    if (!this.pendingMapFocus) return;
    this.pendingMapFocus = false;
    // Defer to the next frame so #mapCard exists in the DOM after *ngIf flips.
    setTimeout(() => this.scrollToMap(), 60);
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
          if (--remaining === 0) { this.loading.set(false); this.maybeFocusMap(); }
        },
        error: () => {
          if (--remaining === 0) {
            this.loading.set(false);
            if (!anyOk) this.error.set('Could not reach the fund engine. Is the backend running?');
            else this.maybeFocusMap();
          }
        },
      });
    }
  }

  select(k: VariantKey): void { this.active.set(k); }
  goBack(): void { this.back.emit(); }

  /** The unique development name + locality for the active scheme. */
  schemeName = computed<string>(() => schemeName(this.property, this.active()));
  schemeLocality = computed<string>(() => schemeLocality(this.property, this.active()));

  // ── Risk–reward map ─────────────────────────────────────────────────────────
  readonly mapW = 680;
  readonly mapH = 460;
  readonly mapPad = 46;

  /** Which pin the customer tapped on the map (null = the current scheme). */
  pinnedKey = signal<string | null>(null);

  /** Raw risk/reward per scheme, before normalising to the box.
   *  reward = the desk's expected growth %. risk = a tier-based swing proxy,
   *  refined with the REAL measured volatility for any variant we've loaded. */
  private rawScheme(property: PropertyKey, variant: VariantKey): { reward: number; risk: number } {
    const v = PACKAGES[property].variants[variant];
    const reward = v.targetGrowth;
    // Tier baseline risk (pre-launch swings hardest); nudged by the growth level.
    const tierRisk: Record<VariantKey, number> = { conservative: 10, balanced: 15, aggressive: 22 };
    let risk = tierRisk[variant] + (v.targetGrowth - 8) * 0.4;
    // If this is the property we're viewing and its metrics are in, use the real
    // measured volatility — makes the current dev's pins honest.
    if (property === this.property) {
      const m = this.metrics()[variant];
      if (m?.volatility != null) risk = m.volatility;
      if (m?.expected_return != null) { /* reward stays the desk figure for comparability */ }
    }
    return { reward, risk };
  }

  /** All 12 schemes laid out as pins in the map box. */
  mapPins = computed<MapPin[]>(() => {
    const raws = ALL_SCHEMES.map(s => ({ ...s, ...this.rawScheme(s.property, s.variant) }));
    const risks = raws.map(r => r.risk), rewards = raws.map(r => r.reward);
    const rLo = Math.min(...risks), rHi = Math.max(...risks);
    const wLo = Math.min(...rewards), wHi = Math.max(...rewards);
    const rSpan = rHi - rLo || 1, wSpan = wHi - wLo || 1;
    const innerW = this.mapW - this.mapPad * 2;
    const innerH = this.mapH - this.mapPad * 2;
    return raws.map(r => {
      const risk = (r.risk - rLo) / rSpan;      // 0..1
      const reward = (r.reward - wLo) / wSpan;   // 0..1
      return {
        property: r.property, variant: r.variant,
        name: schemeName(r.property, r.variant),
        locality: schemeLocality(r.property, r.variant),
        risk, reward,
        cx: this.mapPad + risk * innerW,
        cy: this.mapPad + (1 - reward) * innerH,  // reward up
        isCurrent: r.property === this.property && r.variant === this.active(),
        isSelf: r.property === this.property,
      };
    });
  });

  /** The pin currently shown in the readout (tapped, or the active scheme). */
  activePin = computed<MapPin | null>(() => {
    const pins = this.mapPins();
    const key = this.pinnedKey();
    if (key) return pins.find(p => `${p.property}:${p.variant}` === key) ?? null;
    return pins.find(p => p.isCurrent) ?? null;
  });

  /** Its real measured numbers, if we have them (only for the current property). */
  activePinMetrics = computed<BasketMetrics | null>(() => {
    const p = this.activePin();
    if (!p || p.property !== this.property) return null;
    return this.metrics()[p.variant] ?? null;
  });

  tapPin(p: MapPin): void {
    this.pinnedKey.set(`${p.property}:${p.variant}`);
    // Tapping a pin of THIS development also switches the page to that variant.
    if (p.property === this.property) this.select(p.variant);
  }

  @ViewChild('mapCard') mapCard?: ElementRef<HTMLElement>;
  scrollToMap(): void {
    this.mapCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Reward-per-unit-of-risk for the active pin (higher = better deal). */
  rewardPerRisk = computed<number | null>(() => {
    const p = this.activePin();
    if (!p) return null;
    const m = this.activePinMetrics();
    const reward = PACKAGES[p.property].variants[p.variant].targetGrowth;
    const risk = m?.volatility ?? (10 + p.risk * 14);
    return risk > 0 ? reward / risk : null;
  });

  /** A plain-English risk-reward verdict for the active pin. */
  riskRewardVerdict = computed<string>(() => {
    const r = this.rewardPerRisk();
    if (r == null) return '';
    if (r >= 1.0) return 'Strong deal — more reward than the risk you take.';
    if (r >= 0.75) return 'Balanced — reward and risk broadly matched.';
    return 'Racier — you take on more swing for the extra growth.';
  });

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
