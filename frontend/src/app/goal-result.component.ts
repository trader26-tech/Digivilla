import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';

import { BasketItem, BasketMetrics, GoalPreset, GrowthPoint, ModelBasket } from './models';
import { PlannerService } from './planner.service';

/**
 * Placeholder results screen (last step before auth): given the goal, target
 * amount and horizon, it shows the monthly investment needed and how mutual-fund
 * returns do the heavy lifting — "you invest X, the market adds Y". The real
 * fund recommendations come after login; this is the motivating summary.
 *
 * Nothing is saved here — the goal is only persisted once the user signs in.
 */
@Component({
  selector: 'app-goal-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-result.component.html',
  styleUrl: './goal-result.component.scss',
})
export class GoalResultComponent implements OnInit {
  @Input({ required: true }) goal!: GoalPreset;
  @Input() amount = 0; // target corpus
  @Input() years = 0;  // horizon in years

  @Output() continued = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  private api = inject(PlannerService);

  entered = false;

  /** Which full detail page is showing ('invest' | 'returns' | null = main). */
  detailPage: 'invest' | 'returns' | null = null;

  // Fund detail (loaded when the returns page is opened).
  basket: ModelBasket | null = null;
  loadingFunds = false;

  // Real blended 3-year performance of this basket (growth curve, drawdown, CAGR).
  metrics: BasketMetrics | null = null;
  loadingPerf = false;
  perfEntered = false; // flips true a beat after load -> the line draws in

  openDetail(which: 'invest' | 'returns'): void {
    this.detailPage = which;
    if (navigator.vibrate) navigator.vibrate(6);
    if (which === 'invest') {
      // Let the page paint at height 0, then grow the bars in.
      this.barsEntered = false;
      setTimeout(() => (this.barsEntered = true), 80);
    }
    if (which === 'returns' && !this.basket && !this.loadingFunds) {
      this.loadFunds();
    }
  }
  closeDetail(): void {
    this.detailPage = null;
    this.barsEntered = false;
    this.perfEntered = false;
  }

  private loadFunds(): void {
    this.loadingFunds = true;
    this.loadingPerf = true;
    this.api.modelBaskets().subscribe({
      next: (list) => {
        this.basket = list.find((b) => b.key === this.riskKey) ?? list[1] ?? list[0] ?? null;
        this.loadingFunds = false;
        this.loadPerformance();
      },
      error: () => {
        this.loadingFunds = false;
        this.loadingPerf = false;
      },
    });
  }

  /** Fetch the REAL blended 3-year NAV history for this basket's funds. */
  private loadPerformance(): void {
    const items = this.funds.map((f) => ({ scheme_code: f.scheme_code, weight: f.weight }));
    if (!items.length) {
      this.loadingPerf = false;
      return;
    }
    this.api.analyzeBasket(items, true).subscribe({
      next: (m) => {
        this.metrics = m;
        this.loadingPerf = false;
        this.perfEntered = false;
        setTimeout(() => (this.perfEntered = true), 90);
      },
      error: () => (this.loadingPerf = false),
    });
  }

  // ============================================================
  //  Blended 3-year performance chart (from real NAV history).
  // ============================================================

  /** The blended growth series, trimmed to ~the last 3 years for a clean story. */
  get perfSeries(): GrowthPoint[] {
    const g = this.metrics?.growth ?? [];
    if (g.length <= 40) return g;
    return g.slice(-37); // ~last 3 years of monthly points
  }

  /** ₹ that a sample 10k lump sum would be worth today, at the blended CAGR. */
  get perfMultiple(): number {
    const s = this.perfSeries;
    if (s.length < 2) return 0;
    return s[s.length - 1].value / s[0].value;
  }
  get sampleNow(): number {
    return Math.round(10000 * (this.perfMultiple || 1));
  }

  /** Total blended return over the shown window, %. */
  get perfTotalPct(): number {
    const m = this.perfMultiple;
    return m ? Math.round((m - 1) * 100) : 0;
  }

  /** Worst peak-to-trough dip over the window, % (positive number for display). */
  get perfDrawdown(): number {
    const dd = this.metrics?.max_drawdown;
    if (dd != null) return Math.abs(Math.round(dd));
    const s = this.perfSeries;
    const worst = Math.min(0, ...s.map((p) => p.drawdown));
    return Math.abs(Math.round(worst));
  }

  get perfCagr(): number {
    return Math.round(this.metrics?.cagr ?? this.metrics?.return_3y ?? this.annualReturn * 100);
  }

  get perfYears(): number {
    const s = this.perfSeries;
    return Math.max(1, Math.round((s.length - 1) / 12));
  }

  // ---- SVG geometry for the performance line (viewBox 0 0 320 150) ----
  private readonly PW = 320;
  private readonly PH = 150;
  private readonly PPAD = 6;

  private get perfMin(): number {
    const s = this.perfSeries;
    return s.length ? Math.min(...s.map((p) => p.value)) : 0;
  }
  private get perfMax(): number {
    const s = this.perfSeries;
    return s.length ? Math.max(...s.map((p) => p.value)) : 1;
  }
  private px(i: number): number {
    const n = this.perfSeries.length - 1 || 1;
    return this.PPAD + (i / n) * (this.PW - 2 * this.PPAD);
  }
  private py(v: number): number {
    const lo = this.perfMin;
    const hi = this.perfMax;
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    // leave headroom top & bottom
    return this.PH - this.PPAD - t * (this.PH - 2 * this.PPAD);
  }

  get perfLine(): string {
    const s = this.perfSeries;
    if (s.length < 2) return '';
    return s.map((p, i) => `${i ? 'L' : 'M'}${this.px(i).toFixed(1)} ${this.py(p.value).toFixed(1)}`).join(' ');
  }
  get perfArea(): string {
    const s = this.perfSeries;
    if (s.length < 2) return '';
    const line = s.map((p, i) => `${i ? 'L' : 'M'}${this.px(i).toFixed(1)} ${this.py(p.value).toFixed(1)}`).join(' ');
    return `${line} L${this.px(s.length - 1).toFixed(1)} ${this.PH} L${this.px(0).toFixed(1)} ${this.PH} Z`;
  }

  /** The lowest point (worst drawdown) marker, for a red dot on the line. */
  get perfTroughXY(): { x: number; y: number } | null {
    const s = this.perfSeries;
    if (s.length < 2) return null;
    let idx = 0;
    let worst = 0;
    s.forEach((p, i) => {
      if (p.drawdown < worst) {
        worst = p.drawdown;
        idx = i;
      }
    });
    if (worst === 0) return null;
    return { x: this.px(idx), y: this.py(s[idx].value) };
  }
  get perfEndXY(): { x: number; y: number } | null {
    const s = this.perfSeries;
    if (s.length < 2) return null;
    return { x: this.px(s.length - 1), y: this.py(s[s.length - 1].value) };
  }

  /** X-axis: a few year labels evenly along the window. */
  get perfXLabels(): { x: number; label: string }[] {
    const s = this.perfSeries;
    if (s.length < 2) return [];
    const out: { x: number; label: string }[] = [];
    const picks = [0, Math.floor((s.length - 1) / 2), s.length - 1];
    for (const i of picks) {
      const yr = s[i].date.split('-')[0];
      out.push({ x: this.px(i), label: `’${yr.slice(2)}` });
    }
    return out;
  }

  /** Full grouped INR, e.g. ₹17,54,671 — for the donut centre + pills. */
  fullInr(v: number): string {
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  ngOnInit(): void {
    setTimeout(() => (this.entered = true), 30);
  }

  get hue(): number {
    return HUE_OF[this.goal?.key] ?? 222;
  }

  /** The model basket matching this goal's risk (conservative/balanced/aggressive). */
  private get riskKey(): string {
    return this.goal?.default_risk || 'balanced';
  }

  get funds(): BasketItem[] {
    return this.basket?.items ?? [];
  }

  /** Allocation slices for the little "why" ring, from the basket allocation. */
  get allocSlices(): { label: string; pct: number; kind: string }[] {
    const a = this.basket?.allocation ?? {};
    return Object.entries(a)
      .map(([kind, w]) => ({ label: kind, pct: Math.round((w as number) * 100), kind }))
      .filter((s) => s.pct > 0);
  }

  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)', cash: '#94a3b8' }[a] ??
      'var(--accent-h)'
    );
  }
  sign(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }
  stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  /** Expected annualised return, from the goal's risk profile. */
  private get annualReturn(): number {
    const risk = this.goal?.default_risk || 'balanced';
    return risk === 'aggressive' ? 0.12 : risk === 'conservative' ? 0.07 : 0.10;
  }

  get months(): number {
    return Math.max(1, Math.round(this.years * 12));
  }

  /** Monthly SIP needed to reach `amount` at `annualReturn` over `months`.
   *  FV = P * [((1+i)^n - 1) / i] * (1+i)  (SIP at start of month). */
  get monthlySip(): number {
    const i = this.annualReturn / 12;
    const n = this.months;
    if (i <= 0) return Math.round(this.amount / n);
    const factor = ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    return Math.max(0, Math.round(this.amount / factor));
  }

  /** Total the user actually puts in from their pocket. */
  get totalInvested(): number {
    return this.monthlySip * this.months;
  }

  /** What the market adds on top (the growth). */
  get growth(): number {
    return Math.max(0, this.amount - this.totalInvested);
  }

  /** Growth as a % of the final corpus, for the split bar. */
  get growthPct(): number {
    if (this.amount <= 0) return 0;
    return Math.round((this.growth / this.amount) * 100);
  }
  get investedPct(): number {
    return 100 - this.growthPct;
  }

  get returnLabel(): string {
    return `${Math.round(this.annualReturn * 100)}% p.a.`;
  }

  // ============================================================
  //  Growth chart: cumulative invested vs total value, year by year.
  //  Shows compounding — the returns band widens dramatically over time.
  // ============================================================

  /** Per-year points: what you've put in vs what it's worth. */
  get growthSeries(): { year: number; invested: number; value: number }[] {
    const i = this.annualReturn / 12;
    const p = this.monthlySip;
    const totalYears = Math.max(1, Math.round(this.years));
    const pts: { year: number; invested: number; value: number }[] = [];
    for (let y = 0; y <= totalYears; y++) {
      const n = y * 12;
      const invested = p * n;
      // FV of a monthly SIP after n months (deposits at start of month).
      const value = i <= 0 ? invested : p * (((Math.pow(1 + i, n) - 1) / i) * (1 + i));
      pts.push({ year: y, invested: Math.round(invested), value: Math.round(value) });
    }
    return pts;
  }

  // ============================================================
  //  Bar chart: one bar per milestone year, stacked
  //  (what you invested at the bottom + the extra returns on top).
  // ============================================================

  /** Flips true a beat after entry so the bars grow up with a stagger. */
  barsEntered = false;

  /** 5 evenly-spaced milestone bars along the whole horizon — always 5, even for
   *  a 1-year plan (where they fall at ~2/5/7/10/12 months). Each bar stacks the
   *  invested amount (bottom) + the extra returns (top), sized as a % of the
   *  final corpus so heights are comparable. */
  get barSeries(): {
    label: string; // x-axis label, e.g. "3mo" or "5y"
    invPct: number;
    retPct: number;
    invested: number;
    returns: number;
    total: number;
  }[] {
    const totalMonths = this.months;
    const i = this.annualReturn / 12;
    const p = this.monthlySip;
    if (totalMonths <= 0 || p <= 0) return [];

    const BARS = 5;
    // The tallest (final) corpus sets the scale.
    const fv = (n: number) =>
      i <= 0 ? p * n : p * (((Math.pow(1 + i, n) - 1) / i) * (1 + i));
    const maxVal = Math.max(1, fv(totalMonths));

    const out = [];
    for (let k = 1; k <= BARS; k++) {
      const n = Math.max(1, Math.round((k / BARS) * totalMonths));
      const invested = p * n;
      const value = fv(n);
      const returns = Math.max(0, value - invested);
      out.push({
        label: this.monthsLabel(n),
        invPct: (invested / maxVal) * 100,
        retPct: (returns / maxVal) * 100,
        invested: Math.round(invested),
        returns: Math.round(returns),
        total: Math.round(value),
      });
    }
    return out;
  }

  /** Compact axis label for a number of months: "3mo", "9mo", "2y", "5y". */
  private monthsLabel(n: number): string {
    if (n < 12) return `${n}mo`;
    const y = n / 12;
    return `${Number.isInteger(y) ? y : y.toFixed(1)}y`;
  }

  /** Chart geometry in a 320×200 viewBox (plot area inset for labels). */
  private readonly chartW = 320;
  private readonly chartH = 200;
  private readonly padL = 8;
  private readonly padR = 8;
  private readonly padT = 14;
  private readonly padB = 20;

  private get chartMax(): number {
    const s = this.growthSeries;
    return Math.max(1, s[s.length - 1]?.value ?? 1);
  }
  private xAt(year: number): number {
    const yrs = Math.max(1, Math.round(this.years));
    const w = this.chartW - this.padL - this.padR;
    return this.padL + (year / yrs) * w;
  }
  private yAt(v: number): number {
    const h = this.chartH - this.padT - this.padB;
    return this.padT + h - (v / this.chartMax) * h;
  }

  /** Smooth path along the TOTAL value line (top of the returns band). */
  get valuePath(): string {
    return this.linePath(this.growthSeries.map((p) => [this.xAt(p.year), this.yAt(p.value)]));
  }
  /** Smooth path along the INVESTED line (top of the contributions band). */
  get investedPath(): string {
    return this.linePath(this.growthSeries.map((p) => [this.xAt(p.year), this.yAt(p.invested)]));
  }
  /** Filled area under the total value line (the returns fill). */
  get valueArea(): string {
    const base = this.chartH - this.padB;
    const line = this.linePath(this.growthSeries.map((p) => [this.xAt(p.year), this.yAt(p.value)]));
    const last = this.growthSeries[this.growthSeries.length - 1];
    return `${line} L ${this.xAt(last.year)} ${base} L ${this.xAt(0)} ${base} Z`;
  }
  /** Filled area under the invested line (the contributions fill). */
  get investedArea(): string {
    const base = this.chartH - this.padB;
    const line = this.linePath(this.growthSeries.map((p) => [this.xAt(p.year), this.yAt(p.invested)]));
    const last = this.growthSeries[this.growthSeries.length - 1];
    return `${line} L ${this.xAt(last.year)} ${base} L ${this.xAt(0)} ${base} Z`;
  }

  /** Catmull-Rom → cubic bezier smoothing for a soft, premium curve. */
  private linePath(pts: [number, number][]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k - 1] ?? pts[k];
      const p1 = pts[k];
      const p2 = pts[k + 1];
      const p3 = pts[k + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  /** X-axis tick years — a few evenly spaced markers. */
  get xTicks(): { year: number; x: number }[] {
    const yrs = Math.max(1, Math.round(this.years));
    const step = yrs <= 6 ? 1 : yrs <= 12 ? 2 : 5;
    const out: { year: number; x: number }[] = [];
    for (let y = 0; y <= yrs; y += step) out.push({ year: y, x: this.xAt(y) });
    if (out[out.length - 1].year !== yrs) out.push({ year: yrs, x: this.xAt(yrs) });
    return out;
  }

  /** End-point coordinates for the labels/dots. */
  get endValueXY(): { x: number; y: number } {
    const last = this.growthSeries[this.growthSeries.length - 1];
    return { x: this.xAt(last.year), y: this.yAt(last.value) };
  }
  get endInvestedXY(): { x: number; y: number } {
    const last = this.growthSeries[this.growthSeries.length - 1];
    return { x: this.xAt(last.year), y: this.yAt(last.invested) };
  }

  // ---- donut ring geometry: two clean segments with a small gap ----
  readonly ringR = 52; // radius in the 120x120 viewBox
  private readonly GAP = 14; // gap between segments (wide enough for rounded caps)
  get ringCirc(): number {
    return 2 * Math.PI * this.ringR;
  }
  /** "You invest" segment: its share of the circle, minus a gap, flat ends. */
  get investedDash(): string {
    const seg = Math.max(0, (this.investedPct / 100) * this.ringCirc - this.GAP);
    return `${seg} ${this.ringCirc - seg}`;
  }
  /** "Returns" segment, offset to start after the invested segment + gap. */
  get growthDash(): string {
    const seg = Math.max(0, (this.growthPct / 100) * this.ringCirc - this.GAP);
    return `${seg} ${this.ringCirc - seg}`;
  }
  get growthOffset(): number {
    // start the returns arc just after the invested segment (+half gap each side)
    return -((this.investedPct / 100) * this.ringCirc) + this.GAP / 2;
  }
  get investedOffset(): number {
    return this.GAP / 2; // nudge so the gap is centered on the seam
  }

  get horizonLabel(): string {
    const y = Math.floor(this.years);
    const m = Math.round((this.years - y) * 12);
    if (y <= 0) return `${this.months} months`;
    return m ? `${y} yr ${m} mo` : `${y} year${y > 1 ? 's' : ''}`;
  }

  compactInr(v: number): string {
    if (v >= 10_000_000) {
      const cr = v / 10_000_000;
      return `₹${cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
    }
    if (v >= 100_000) {
      const l = v / 100_000;
      return `₹${l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')} L`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  goBack(): void {
    this.back.emit();
  }
  proceed(): void {
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
    this.continued.emit();
  }

  // ---- slide-to-confirm ----
  slidePct = 0;            // 0..100 knob progress
  private sliding = false;
  private trackEl: HTMLElement | null = null;
  confirmed = false;

  startSlide(ev: PointerEvent): void {
    if (this.confirmed) return;
    this.sliding = true;
    this.trackEl = (ev.currentTarget as HTMLElement).parentElement;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  moveSlide(ev: PointerEvent): void {
    if (!this.sliding || !this.trackEl || this.confirmed) return;
    const rect = this.trackEl.getBoundingClientRect();
    const knob = 56; // knob width
    const x = ev.clientX - rect.left - knob / 2;
    const max = rect.width - knob;
    this.slidePct = Math.max(0, Math.min(100, (x / max) * 100));
    if (this.slidePct >= 96) this.completeSlide();
  }
  endSlide(): void {
    if (this.confirmed) return;
    this.sliding = false;
    if (this.slidePct < 96) this.slidePct = 0; // snap back if not far enough
  }
  private completeSlide(): void {
    this.sliding = false;
    this.slidePct = 100;
    this.confirmed = true;
    this.proceed();
  }
}

const HUE_OF: Record<string, number> = {
  emergency: 190,
  health: 356,
  car: 205,
  wedding: 330,
  vacation: 25,
  gadget: 262,
  house: 222,
  child_education: 268,
  retirement: 28,
  wealth: 150,
};
