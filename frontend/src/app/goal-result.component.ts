import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';

import { BasketItem, GoalPreset, ModelBasket } from './models';
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

  @Output() continued = new EventEmitter<number>(); // emits the monthly SIP
  @Output() back = new EventEmitter<void>();

  private api = inject(PlannerService);

  entered = false;

  /** Which full detail page is showing ('invest' | 'returns' | null = main). */
  detailPage: 'invest' | 'returns' | null = null;

  // Fund detail (loaded when the returns page is opened).
  basket: ModelBasket | null = null;
  loadingFunds = false;

  openDetail(which: 'invest' | 'returns'): void {
    this.detailPage = which;
    if (navigator.vibrate) navigator.vibrate(6);
    if (which === 'invest') {
      // Let the page paint at height 0, then grow the bars in.
      this.barsEntered = false;
      setTimeout(() => (this.barsEntered = true), 80);
    }
    if (which === 'returns') {
      // The projection is computed on-device from THEIR plan — no fetch needed.
      // Default the scrub head to the final month (goal reached).
      this.scrubIdx = this.sipSeries.length - 1;
      this.perfEntered = false;
      setTimeout(() => (this.perfEntered = true), 80);
      // Load the funds only for the little allocation bar (optional, non-blocking).
      if (!this.basket && !this.loadingFunds) this.loadFunds();
    }
  }
  closeDetail(): void {
    this.detailPage = null;
    this.barsEntered = false;
    this.perfEntered = false;
  }

  private loadFunds(): void {
    this.loadingFunds = true;
    this.api.modelBaskets().subscribe({
      next: (list) => {
        this.basket = list.find((b) => b.key === this.riskKey) ?? list[1] ?? list[0] ?? null;
        this.loadingFunds = false;
      },
      error: () => (this.loadingFunds = false),
    });
  }

  // ============================================================
  //  Personalized SIP projection — THEIR plan, month by month.
  //  Invested (what they put in) vs Total value (with market growth).
  //  Scrubbable: tap/drag the chart to read any month.
  // ============================================================

  perfEntered = false; // flips true a beat after open -> the line draws in
  scrubIdx = 0;        // which month the scrub head is on
  scrubbing = false;   // true while the user is dragging on the chart

  /** The monthly amount they commit — LOCKED across risk styles. Solved once
   *  from the goal's default risk so switching risk keeps ₹/mo fixed and lets
   *  the FINAL value move instead (aggressive ends higher, safe ends lower). */
  get baselineSip(): number {
    const defRisk = this.goal?.default_risk || 'balanced';
    const rate = defRisk === 'aggressive' ? 0.12 : defRisk === 'conservative' ? 0.07 : 0.10;
    const i = rate / 12;
    const n = this.months;
    if (i <= 0) return Math.round(this.amount / n);
    const factor = ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    return Math.max(0, Math.round(this.amount / factor));
  }

  /** Per-month projection: FIXED monthly SIP, grown at the ACTIVE risk's rate.
   *  Invested line is identical across risks; the value line diverges by risk. */
  get sipSeries(): { month: number; invested: number; value: number }[] {
    const i = this.annualReturn / 12; // active risk rate
    const p = this.baselineSip;       // fixed monthly amount
    const n = this.months;
    const out: { month: number; invested: number; value: number }[] = [];
    for (let m = 0; m <= n; m++) {
      const invested = p * m;
      const value = i <= 0 ? invested : p * (((Math.pow(1 + i, m) - 1) / i) * (1 + i));
      out.push({ month: m, invested: Math.round(invested), value: Math.round(value) });
    }
    return out;
  }

  /** Final projected value at the active risk (moves with the risk choice). */
  get projectedFinal(): number {
    const s = this.sipSeries;
    return s.length ? s[s.length - 1].value : this.amount;
  }

  /** How the projected final compares to the goal — drives the "beats/misses" note. */
  get goalDelta(): number { return this.projectedFinal - this.amount; }
  get goalDeltaLabel(): string {
    const d = Math.round(this.goalDelta);
    if (Math.abs(d) < this.amount * 0.02) return `Right on your ${this.compactInr(this.amount)} goal`;
    return d > 0
      ? `${this.compactInr(d)} above your goal 🎉`
      : `${this.compactInr(-d)} short of your goal`;
  }
  get goalBeaten(): boolean { return this.goalDelta > this.amount * 0.02; }
  get goalShort(): boolean { return this.goalDelta < -this.amount * 0.02; }

  /** The point currently under the scrub head. */
  get scrubPt(): { month: number; invested: number; value: number } {
    const s = this.sipSeries;
    const idx = Math.max(0, Math.min(this.scrubIdx, s.length - 1));
    return s[idx] ?? { month: 0, invested: 0, value: 0 };
  }
  get scrubInvested(): number { return this.scrubPt.invested; }
  get scrubValue(): number { return this.scrubPt.value; }
  get scrubReturns(): number { return Math.max(0, this.scrubPt.value - this.scrubPt.invested); }

  /** A friendly label for the scrubbed month, e.g. "Month 8" or "Year 3". */
  get scrubTimeLabel(): string {
    const m = this.scrubPt.month;
    if (m === 0) return 'Start';
    if (m % 12 === 0) return `Year ${m / 12}`;
    if (m < 12) return `Month ${m}`;
    const y = Math.floor(m / 12);
    return `Year ${y}, mo ${m % 12}`;
  }

  // ---- SVG geometry (viewBox 0 0 320 160) ----
  private readonly PW = 320;
  private readonly PH = 160;
  private readonly PPAD = 8;

  /** Y-axis ceiling — FIXED to the most-aggressive outcome so the scale does NOT
   *  rescale when risk changes. Safe visibly falls short; aggressive fills the top. */
  private get sipMax(): number {
    const p = this.baselineSip;
    const n = this.months;
    const i = 0.12 / 12; // aggressive rate = the tallest possible line
    const top = i <= 0 ? p * n : p * (((Math.pow(1 + i, n) - 1) / i) * (1 + i));
    return Math.max(1, Math.round(top));
  }
  px(idx: number): number {
    const n = this.sipSeries.length - 1 || 1;
    return this.PPAD + (idx / n) * (this.PW - 2 * this.PPAD);
  }
  private pyVal(v: number): number {
    const hi = this.sipMax || 1;
    const t = v / hi;
    return this.PH - this.PPAD - t * (this.PH - 2 * this.PPAD);
  }

  /** Y of the goal target line — fixed reference; the value line lands above it
   *  (aggressive) or below it (safe), making the risk difference obvious. */
  get goalLineY(): number { return this.pyVal(this.amount); }

  private path(key: 'value' | 'invested'): string {
    const s = this.sipSeries;
    if (s.length < 2) return '';
    return s.map((p, idx) => `${idx ? 'L' : 'M'}${this.px(idx).toFixed(1)} ${this.pyVal(p[key]).toFixed(1)}`).join(' ');
  }
  get valueLine(): string { return this.path('value'); }
  get investedLine(): string { return this.path('invested'); }

  /** Filled area between the two lines = the market's contribution (returns). */
  get returnsArea(): string {
    const s = this.sipSeries;
    if (s.length < 2) return '';
    const top = s.map((p, idx) => `${idx ? 'L' : 'M'}${this.px(idx).toFixed(1)} ${this.pyVal(p.value).toFixed(1)}`).join(' ');
    const bottom = s
      .slice()
      .reverse()
      .map((p, k) => `L${this.px(s.length - 1 - k).toFixed(1)} ${this.pyVal(p.invested).toFixed(1)}`)
      .join(' ');
    return `${top} ${bottom} Z`;
  }
  /** Area under the invested line = their own money. */
  get investedArea2(): string {
    const s = this.sipSeries;
    if (s.length < 2) return '';
    const line = s.map((p, idx) => `${idx ? 'L' : 'M'}${this.px(idx).toFixed(1)} ${this.pyVal(p.invested).toFixed(1)}`).join(' ');
    return `${line} L${this.px(s.length - 1).toFixed(1)} ${this.PH} L${this.px(0).toFixed(1)} ${this.PH} Z`;
  }

  get scrubX(): number { return this.px(Math.max(0, Math.min(this.scrubIdx, this.sipSeries.length - 1))); }
  get scrubValY(): number { return this.pyVal(this.scrubValue); }
  get scrubInvY(): number { return this.pyVal(this.scrubInvested); }

  /** Y-axis money ticks (top→bottom): value label + its y position as a % of chart height. */
  get yAxisTicks(): { label: string; topPct: number; y: number }[] {
    const hi = this.sipMax || 1;
    const steps = 4; // 4 gridlines: full, ¾, ½, ¼ (baseline handled separately)
    const out: { label: string; topPct: number; y: number }[] = [];
    for (let k = steps; k >= 1; k--) {
      const v = (hi * k) / steps;
      const y = this.pyVal(v);
      out.push({ label: this.compactInr(v), topPct: (y / this.PH) * 100, y });
    }
    return out;
  }

  /** X-axis time ticks: friendly label + x position as a % of chart width. */
  get xAxisTicks(): { label: string; leftPct: number; x: number }[] {
    const n = this.months;
    const yrs = n / 12;
    const out: { label: string; leftPct: number; x: number }[] = [];
    const pushMonth = (m: number) => {
      const idx = Math.max(0, Math.min(m, n));
      const x = this.px(idx);
      out.push({ label: this.axisTime(idx), leftPct: (x / this.PW) * 100, x });
    };
    if (n <= 12) {
      // short goal → mark start, mid, end in months
      [0, Math.round(n / 2), n].forEach(pushMonth);
    } else {
      const totalY = Math.round(yrs);
      const step = totalY <= 6 ? 1 : totalY <= 12 ? 2 : 5;
      for (let y = 0; y <= totalY; y += step) pushMonth(y * 12);
      // Add a final "end" tick only if it's far enough from the last stepped one
      // to not collide (labels are ~10% of the width wide).
      const last = out[out.length - 1];
      const endX = this.px(n);
      if ((endX - last.x) / this.PW > 0.1) pushMonth(n);
    }
    return out;
  }
  private axisTime(m: number): string {
    if (m === 0) return 'Now';
    if (m < 12) return `${m}mo`;
    const y = m / 12;
    // whole years read cleaner; only show a decimal when it's genuinely mid-year
    if (Number.isInteger(y)) return `${y}y`;
    const rounded = Math.round(y);
    return Math.abs(y - rounded) < 0.15 ? `${rounded}y` : `${y.toFixed(1)}y`;
  }

  // ---- Fund allocation pie (donut) — how the money splits across funds ----

  /** Distinct slice colours for the allocation pie — a cool green→teal→blue
   *  ramp (deliberately not orange/yellow), one per fund. */
  private readonly PIE_COLORS = [
    '#34d399', '#10b981', '#2dd4bf', '#22c55e', '#14b8a6',
    '#4ade80', '#06b6d4', '#3bb78f', '#0ea5a5', '#5eead4',
  ];
  private readonly PIE_R = 42;              // donut radius in the 120×120 viewBox
  get pieCirc(): number { return 2 * Math.PI * this.PIE_R; }

  /** Each fund as a donut segment: colour, dash geometry, name + %. */
  get fundPie(): {
    name: string; color: string; pct: number; dash: string; offset: number;
  }[] {
    const items = this.funds;
    if (!items.length) return [];
    const total = items.reduce((s, f) => s + (f.weight || 0), 0) || 1;
    const C = this.pieCirc;
    let acc = 0;
    return items.map((f, idx) => {
      const frac = (f.weight || 0) / total;
      const seg = frac * C;
      const offset = -acc * C; // where this slice starts around the ring
      acc += frac;
      return {
        name: f.name,
        color: this.PIE_COLORS[idx % this.PIE_COLORS.length],
        pct: Math.round(frac * 100),
        dash: `${seg} ${C - seg}`,
        offset,
      };
    });
  }

  /** Handle a pointer move over the chart -> snap the scrub head to the nearest month. */
  onScrub(ev: PointerEvent, el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const n = this.sipSeries.length - 1;
    // account for the horizontal padding baked into px()
    const usable = (this.PW - 2 * this.PPAD) / this.PW;
    const adj = Math.max(0, Math.min(1, (frac - this.PPAD / this.PW) / usable));
    this.scrubIdx = Math.round(adj * n);
    if (navigator.vibrate) navigator.vibrate(2);
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

  /** User-chosen risk. null = use the goal's default. Lets them make the plan
   *  more/less aggressive right on the returns screen. */
  riskOverride: 'conservative' | 'balanced' | 'aggressive' | null = null;

  readonly riskOptions: { key: 'conservative' | 'balanced' | 'aggressive'; label: string; blurb: string }[] = [
    { key: 'conservative', label: 'Safe', blurb: 'Steadier, lower risk' },
    { key: 'balanced', label: 'Balanced', blurb: 'A healthy mix' },
    { key: 'aggressive', label: 'Aggressive', blurb: 'Higher risk & reward' },
  ];

  /** The model basket matching the active risk (override or the goal default). */
  private get riskKey(): string {
    return this.riskOverride || this.goal?.default_risk || 'balanced';
  }

  /** User taps a risk chip -> re-derive returns and reload that basket's mix. */
  setRisk(key: 'conservative' | 'balanced' | 'aggressive'): void {
    if (this.riskOverride === key) return;
    this.riskOverride = key;
    if (navigator.vibrate) navigator.vibrate(8);
    // keep the scrub head at the end so the total re-lands on the goal
    this.scrubIdx = this.sipSeries.length - 1;
    // re-fetch the matching model basket for the allocation bar
    this.basket = null;
    this.loadFunds();
    // redraw the line
    this.perfEntered = false;
    setTimeout(() => (this.perfEntered = true), 60);
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

  /** Expected annualised return, from the active risk profile (override or default). */
  private get annualReturn(): number {
    const risk = this.riskOverride || this.goal?.default_risk || 'balanced';
    return risk === 'aggressive' ? 0.12 : risk === 'conservative' ? 0.07 : 0.10;
  }

  /** The currently-active risk key (for highlighting the chosen chip). */
  get activeRisk(): string {
    return this.riskOverride || this.goal?.default_risk || 'balanced';
  }

  get months(): number {
    return Math.max(1, Math.round(this.years * 12));
  }

  /** Human-friendly headline: months when under a year, otherwise years. */
  get reachValue(): string {
    const m = this.months;
    if (m < 12) return `${m}`;
    const y = m / 12;
    return Number.isInteger(y) ? `${y}` : y.toFixed(1);
  }
  get reachUnit(): string {
    const m = this.months;
    if (m < 12) return m === 1 ? 'month' : 'months';
    const y = m / 12;
    return y === 1 ? 'year' : 'years';
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
  private readonly GAP = 4; // small even gap between the two segments (flat caps)
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

  /** Celebration: a full-screen moment. The ring builds + spins into a tick,
   *  the plan facts count up, then (after ~3.5s) a "Continue" button appears.
   *  We do NOT auto-advance — the user taps Continue. Triggered by
   *  slide-to-invest or "I'll do this later". */
  celebrating = false;
  celebrationReady = false; // flips true after the animation -> reveal Continue

  proceed(): void {
    if (this.celebrating) return;
    if (navigator.vibrate) navigator.vibrate([12, 40, 12, 40, 60]);
    this.celebrating = true;
    this.celebrationReady = false;
    // Let the whole sequence play (~3.5s), THEN reveal the Continue button.
    setTimeout(() => {
      this.celebrationReady = true;
      if (navigator.vibrate) navigator.vibrate(20);
    }, 3400);
  }

  /** User tapped Continue on the celebration -> hand off to the home screen. */
  finishCelebration(): void {
    if (navigator.vibrate) navigator.vibrate(10);
    this.continued.emit(this.monthlySip);
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
