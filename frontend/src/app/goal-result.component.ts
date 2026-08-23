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

  @Output() continued = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  private api = inject(PlannerService);

  entered = false;

  /** Which detail pill is expanded ('invest' | 'returns' | null). */
  openPill: 'invest' | 'returns' | null = null;

  // Fund detail (loaded when the returns pill is opened).
  basket: ModelBasket | null = null;
  loadingFunds = false;

  togglePill(which: 'invest' | 'returns'): void {
    this.openPill = this.openPill === which ? null : which;
    if (navigator.vibrate) navigator.vibrate(6);
    if (which === 'returns' && this.openPill === 'returns' && !this.basket && !this.loadingFunds) {
      this.loadFunds();
    }
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

  // ---- donut ring geometry (outer rim only) ----
  readonly ringR = 52; // radius in the 120x120 viewBox
  get ringCirc(): number {
    return 2 * Math.PI * this.ringR;
  }
  /** Dash length for the "you invest" arc (rest is the growth arc). */
  get investedDash(): string {
    const inv = (this.investedPct / 100) * this.ringCirc;
    return `${inv} ${this.ringCirc - inv}`;
  }
  /** Growth arc starts where invested ends: offset it. */
  get growthDash(): string {
    const grw = (this.growthPct / 100) * this.ringCirc;
    return `${grw} ${this.ringCirc - grw}`;
  }
  get growthOffset(): number {
    return -((this.investedPct / 100) * this.ringCirc);
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
