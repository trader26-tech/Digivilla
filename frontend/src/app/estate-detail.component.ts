import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';

import { BasketMetrics, LandDetailService } from './land-detail.service';
import {
  PACKAGES, PropertyKey, VariantKey, Leg, LegRole, ROLE_LABEL,
  RISK_SHORT, WITHDRAWAL_RULES, TAX_NOTE, schemeName, schemeLocality,
} from './property-package.data';

interface AllocSlice { key: 'equity' | 'debt' | 'gold' | 'cash'; label: string; pct: number; }
interface ChartSource { id: string; label: string; }

/** Look-through by role: what asset class a leg mostly holds. Keeps the "where
 *  your money sits" split honest for income tiers without per-fund look data. */
const ROLE_LOOK: Record<LegRole, { equity: number; debt: number; cash: number }> = {
  income: { equity: 0.05, debt: 0.10, cash: 0.85 },  // arbitrage / equity-savings ≈ cash-like
  growth: { equity: 0.95, debt: 0.00, cash: 0.05 },
  hedge:  { equity: 0.50, debt: 0.35, cash: 0.15 },  // BAF / multi-asset
  liquid: { equity: 0.00, debt: 0.15, cash: 0.85 },
};

/**
 * The income-tier detail page (Flat / Apartment / Duplex) — the SAME clean,
 * minimal template as Land, PLUS the bit Land doesn't have: how the monthly
 * amount actually reaches you (the bucket machine) and why it is tax-efficient.
 * No Monte Carlo — just real measured history + the withdrawal mechanics.
 */
@Component({
  selector: 'app-estate-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './estate-detail.component.html',
  styleUrl: './estate-detail.component.scss',
})
export class EstateDetailComponent implements OnInit, OnDestroy {
  @Input() property: PropertyKey = 'flat';
  @Input() initialVariant: VariantKey = 'balanced';
  @Output() back = new EventEmitter<void>();

  private api = inject(LandDetailService);

  readonly variantKeys: VariantKey[] = ['conservative', 'balanced', 'aggressive'];
  readonly RISK_SHORT = RISK_SHORT;
  readonly ROLE_LABEL = ROLE_LABEL;
  readonly withdrawalRules = WITHDRAWAL_RULES;
  readonly taxNote = TAX_NOTE;

  active = signal<VariantKey>('balanced');

  get pkg() { return PACKAGES[this.property]; }
  get ticketPrice() { return this.pkg.price; }

  activeVariant = computed(() => this.pkg.variants[this.active()]);
  plotName = computed(() => `${schemeName(this.property, this.active())} ${this.pkg.name}`);
  plotLocality = computed(() => schemeLocality(this.property, this.active()));

  /** Total monthly income this variant targets (₹). */
  rentMonthly = computed(() => this.activeVariant().rentMonthly);

  // ── data load ────────────────────────────────────────────────────────────────
  metrics = signal<Record<string, BasketMetrics>>({});
  fundMetrics = signal<Record<number, BasketMetrics>>({});
  loading = signal(true);
  error = signal<string | null>(null);
  chartSource = signal<string>('blend');

  activeMetrics = computed<BasketMetrics | null>(() => this.metrics()[this.active()] ?? null);

  // ── range tabs ───────────────────────────────────────────────────────────────
  readonly ranges = [
    { key: '1y', label: '1Y', months: 12 },
    { key: '2y', label: '2Y', months: 24 },
    { key: '3y', label: '3Y', months: 36 },
    { key: '5y', label: '5Y', months: 60 },
  ];
  chartRange = signal<string>('3y');
  setRange(k: string): void { this.chartRange.set(k); }

  // ── loading benefits (income-flavoured) ──────────────────────────────────────
  readonly benefits = [
    'A monthly income, without a tenant',
    'Rent taxed like equity, not your slab',
    'Growth quietly refills your income',
    'Liquid — redeem in days, not months',
    'Real fund history, no glossy promises',
  ];
  benefitIdx = signal(0);
  private benefitTimer: any = null;

  ngOnInit(): void {
    this.active.set(this.initialVariant);
    this.startBenefits();
    this.loadAll();
  }
  ngOnDestroy(): void { this.stopBenefits(); }

  private startBenefits(): void {
    this.stopBenefits();
    this.benefitTimer = setInterval(() => this.benefitIdx.update(i => (i + 1) % this.benefits.length), 2600);
  }
  private stopBenefits(): void { if (this.benefitTimer) { clearInterval(this.benefitTimer); this.benefitTimer = null; } }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    let remaining = this.variantKeys.length;
    let anyOk = false;
    for (const vk of this.variantKeys) {
      const v = this.pkg.variants[vk];
      const items = v.legs.map(l => ({ scheme_code: l.scheme_code, weight: l.weight }));
      this.api.analyze(items).subscribe({
        next: m => {
          this.metrics.update(cur => ({ ...cur, [vk]: m }));
          anyOk = true;
          if (--remaining === 0) { this.loading.set(false); this.stopBenefits(); }
        },
        error: () => {
          if (--remaining === 0) {
            this.loading.set(false); this.stopBenefits();
            if (!anyOk) this.error.set('Could not reach the fund engine. Is the backend running?');
          }
        },
      });
    }
  }

  private ensureFund(code: number): void {
    if (this.fundMetrics()[code]) return;
    this.api.analyze([{ scheme_code: code, weight: 1 }]).subscribe({
      next: m => this.fundMetrics.update(cur => ({ ...cur, [code]: m })),
      error: () => {},
    });
  }

  chartSources = computed<ChartSource[]>(() => {
    const opts: ChartSource[] = [{ id: 'blend', label: 'Combined basket' }];
    for (const leg of this.activeVariant().legs) opts.push({ id: String(leg.scheme_code), label: leg.label });
    return opts;
  });
  pickChartSource(id: string): void { this.chartSource.set(id); if (id !== 'blend') this.ensureFund(Number(id)); }

  select(k: VariantKey): void { this.active.set(k); this.chartSource.set('blend'); }
  goBack(): void { this.back.emit(); }

  chartMetrics = computed<BasketMetrics | null>(() => {
    const src = this.chartSource();
    if (src === 'blend') return this.activeMetrics();
    return this.fundMetrics()[Number(src)] ?? null;
  });
  chartLoading = computed<boolean>(() => this.chartSource() !== 'blend' && !this.chartMetrics());

  windowedGrowth = computed(() => {
    const m = this.chartMetrics();
    if (!m || !m.growth.length) return [];
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 36;
    return m.growth.slice(Math.max(0, m.growth.length - (months + 1)));
  });

  windowReadout = computed<{ from: number; to: number; pct: number } | null>(() => {
    const w = this.windowedGrowth();
    if (w.length < 2) return null;
    const base = this.ticketPrice;
    const first = w[0].value, last = w[w.length - 1].value;
    if (first <= 0) return null;
    return { from: base, to: base * (last / first), pct: (last / first - 1) * 100 };
  });

  // ── look-through allocation ──────────────────────────────────────────────────
  allocation = computed<AllocSlice[]>(() => {
    const acc = { equity: 0, debt: 0, gold: 0, cash: 0 };
    for (const l of this.activeVariant().legs) {
      const look = ROLE_LOOK[l.role];
      acc.equity += l.weight * look.equity;
      acc.debt += l.weight * look.debt;
      acc.cash += l.weight * look.cash;
    }
    const total = acc.equity + acc.debt + acc.gold + acc.cash || 1;
    const LABELS: Record<AllocSlice['key'], string> = { equity: 'Equity', debt: 'Debt', gold: 'Gold', cash: 'Cash / arbitrage' };
    return (['equity', 'debt', 'gold', 'cash'] as const)
      .map(k => ({ key: k, label: LABELS[k], pct: (acc[k] / total) * 100 }))
      .filter(s => s.pct >= 0.5);
  });

  // ── the funds inside (tap to expand) ─────────────────────────────────────────
  openFund = signal<number | null>(null);
  toggleFund(code: number): void { this.openFund.update(c => (c === code ? null : code)); }

  // ── THE BUCKET MACHINE — the income story, minimal + visual ───────────────────
  legsByRole(role: LegRole): Leg[] { return this.activeVariant().legs.filter(l => l.role === role); }

  incomeLegs = computed(() => this.activeVariant().legs.filter(l => l.role === 'income'));
  growthLegs = computed(() => this.activeVariant().legs.filter(l => l.role === 'growth'));
  hedgeLegs = computed(() => this.activeVariant().legs.filter(l => l.role === 'hedge'));
  liquidLegs = computed(() => this.activeVariant().legs.filter(l => l.role === 'liquid'));
  hasGrowth = computed(() => this.growthLegs().length > 0 || this.hedgeLegs().length > 0);
  hasLiquid = computed(() => this.liquidLegs().length > 0);

  /** ₹ sitting in the income sleeve, and how many months of rent that is. */
  incomeSleeve = computed(() => {
    const w = this.incomeLegs().reduce((s, l) => s + l.weight, 0);
    return this.ticketPrice * w;
  });
  runwayMonths = computed<number | null>(() => {
    const rent = this.rentMonthly();
    if (!rent) return null;
    return Math.round(this.incomeSleeve() / rent);
  });
  runwayYears = computed<number | null>(() => {
    const m = this.runwayMonths();
    return m == null ? null : Math.floor(m / 12);
  });

  // ── formatting ───────────────────────────────────────────────────────────────
  inr(v: number | null | undefined): string { return v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'); }
  compact(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v >= 1_00_00_000) { const cr = v / 1_00_00_000; return '₹' + (cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')) + 'Cr'; }
    if (v >= 1_00_000) { const l = v / 1_00_000; return '₹' + (l % 1 === 0 ? l : l.toFixed(2).replace(/\.?0+$/, '')) + 'L'; }
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  pct(v: number | null | undefined, dp = 1): string { return v == null ? '—' : v.toFixed(dp) + '%'; }
  roleLabel(r: LegRole): string { return ROLE_LABEL[r]; }

  // ── SVG chart geometry (windowed, with axes + hover) ─────────────────────────
  readonly chartW = 680; readonly chartH = 260;
  readonly padL = 58; readonly padR = 10; readonly padT = 12; readonly padB = 30;
  private get plotW() { return this.chartW - this.padL - this.padR; }
  private get plotH() { return this.chartH - this.padT - this.padB; }

  private vBounds = computed<{ lo: number; hi: number } | null>(() => {
    const w = this.windowedGrowth();
    if (!w.length) return null;
    const vals = w.map(g => g.value);
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
  });
  private xAt(i: number, n: number) { return this.padL + (n <= 1 ? 0 : (i / (n - 1)) * this.plotW); }
  private yAt(v: number, lo: number, hi: number) { const s = hi - lo || 1; return this.padT + (1 - (v - lo) / s) * this.plotH; }

  growthPath = computed<string>(() => {
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (!w.length || !b) return '';
    return w.map((g, i) => `${i === 0 ? 'M' : 'L'}${this.xAt(i, w.length).toFixed(1)} ${this.yAt(g.value, b.lo, b.hi).toFixed(1)}`).join(' ');
  });
  growthArea = computed<string>(() => {
    const line = this.growthPath(); const w = this.windowedGrowth();
    if (!line || !w.length) return '';
    const baseY = this.chartH - this.padB;
    return `${line} L${this.xAt(w.length - 1, w.length).toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  });
  yTicks = computed(() => {
    const b = this.vBounds(); if (!b) return [];
    const out: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) { const v = b.lo + (i / 4) * (b.hi - b.lo); out.push({ y: this.yAt(v, b.lo, b.hi), label: this.compact(v) }); }
    return out;
  });
  xTicks = computed(() => {
    const w = this.windowedGrowth(); if (!w.length) return [];
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 36;
    const short = months <= 24;
    const count = Math.min(5, w.length);
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * (w.length - 1));
      const d = w[idx].date || '';
      out.push({ x: this.xAt(idx, w.length), label: short ? this.monLabel(d) : d.slice(0, 4) });
    }
    return out;
  });
  private monLabel(ym: string) {
    const [y, mo] = ym.split('-');
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return mo ? `${MON[+mo] || ''} '${(y || '').slice(2)}` : (y || '');
  }
  growthEndpoints = computed(() => {
    const w = this.windowedGrowth(); if (!w.length) return null;
    return { startVal: w[0].value, endVal: w[w.length - 1].value, startDate: w[0].date, endDate: w[w.length - 1].date };
  });

  hoverIdx = signal<number | null>(null);
  onChartMove(ev: MouseEvent): void {
    const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
    const w = this.windowedGrowth();
    if (!w.length || rect.width === 0) return;
    const xView = ((ev.clientX - rect.left) / rect.width) * this.chartW;
    const frac = Math.max(0, Math.min(1, (xView - this.padL) / this.plotW));
    this.hoverIdx.set(Math.round(frac * (w.length - 1)));
  }
  onChartLeave(): void { this.hoverIdx.set(null); }
  hover = computed(() => {
    const i = this.hoverIdx(); const w = this.windowedGrowth(); const b = this.vBounds();
    if (i == null || !w.length || !b || !w[i]) return null;
    const g = w[i];
    const base = this.ticketPrice, wStart = w[0].value;
    const worth = wStart > 0 ? base * (g.value / wStart) : base;
    const growthPct = wStart > 0 ? (g.value / wStart - 1) * 100 : 0;
    return { x: this.xAt(i, w.length), y: this.yAt(g.value, b.lo, b.hi), worth, date: g.date, growthPct };
  });

  trackVar = (_: number, k: VariantKey) => k;
}
