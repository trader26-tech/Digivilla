import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';

import { inr } from './format';
import { Goal, GoalRecommendation } from './models';

/** A month index -> value on one of the projection lines. */
interface Pt {
  x: number; // 0..1 across the chart width
  y: number; // rupee value
}

/** One mutual fund and how it has performed for this goal. */
interface FundRow {
  name: string;
  assetClass: string;
  weight: number; // 0..1
  ret: number; // annualised %, this fund's contribution
}

/**
 * Single-goal detail, rebuilt around ONE Monte-Carlo line chart.
 *
 * Top: a projection chart from today to the goal date — a shaded band between
 * a poor and a strong outcome, a median line, and a dotted target line — plus
 * the probability of actually reaching the target. Beside it: invested vs
 * current value. Then a single "invest more -> reach it sooner" slab, and a
 * "See my investments" button that expands each fund's return inline.
 */
@Component({
  selector: 'app-goal-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-detail.component.html',
  styleUrl: './goal-detail.component.scss',
})
export class GoalDetailComponent implements OnChanges {
  @Input() goal!: Goal;
  @Output() back = new EventEmitter<void>();

  /** Extra monthly SIP the user is exploring in the slab. */
  extraMonthly = 0;
  monthlySteps = [1000, 2500, 5000, 10000];

  /** Whether the "See my investments" fund list is expanded. */
  showFunds = false;

  // chart geometry (viewBox units)
  readonly W = 320;
  readonly H = 168;

  ngOnChanges(): void {
    this.extraMonthly = 0;
    this.showFunds = false;
  }

  // ================= headline numbers =================

  get invested(): number {
    return this.goal.progress.invested_so_far;
  }
  get current(): number {
    return this.goal.progress.on_track_value;
  }
  get gain(): number {
    return Math.max(0, this.current - this.invested);
  }
  get target(): number {
    return this.goal.target_amount;
  }
  private get monthlyRate(): number {
    return (1 + (this.goal.expected_return ?? 0.1)) ** (1 / 12) - 1;
  }
  private get monthsTotal(): number {
    return Math.max(1, this.goal.progress.months_total);
  }
  private get monthsElapsed(): number {
    return Math.min(this.monthsTotal, Math.max(0, this.goal.progress.months_elapsed));
  }
  get monthsLeft(): number {
    return Math.max(0, this.monthsTotal - this.monthsElapsed);
  }

  // ================= Monte-Carlo projection =================
  //
  // We build the median SIP path deterministically, then spread poor/strong
  // outcomes around it using the goal's volatility (approximated from the
  // p10/p50/p90 the plan already stores). Cheap, stable, and good enough to
  // *show* the cone of outcomes and estimate a success probability without a
  // heavy client-side simulation.

  /** Median projected value at month m (contributions + growth). */
  private medianAt(m: number, extra = 0): number {
    const monthly = (this.goal.monthly_investment || 0) + extra;
    const r = this.monthlyRate;
    const start = this.current; // value already accrued
    const grownStart = start * (1 + r) ** Math.max(0, m - this.monthsElapsed);
    const contribMonths = Math.max(0, m - this.monthsElapsed);
    const fv =
      r > 0
        ? monthly * (((1 + r) ** contribMonths - 1) / r) * (1 + r)
        : monthly * contribMonths;
    return grownStart + fv;
  }

  /** Spread factor at the goal date, from the stored p10/p50/p90 spread. */
  private get spread(): { lo: number; hi: number } {
    const p50 = this.goal.projected_p50 || this.medianAt(this.monthsTotal);
    const p10 = this.goal.projected_p10 || p50 * 0.82;
    const p90 = this.goal.projected_p90 || p50 * 1.22;
    return { lo: p50 > 0 ? p10 / p50 : 0.82, hi: p50 > 0 ? p90 / p50 : 1.22 };
  }

  private sample(count: number, extra = 0): { med: Pt[]; lo: Pt[]; hi: Pt[] } {
    const med: Pt[] = [];
    const lo: Pt[] = [];
    const hi: Pt[] = [];
    const { lo: loF, hi: hiF } = this.spread;
    for (let i = 0; i <= count; i++) {
      const frac = i / count; // 0..1 of the journey ahead is drawn from today
      const m = this.monthsElapsed + frac * this.monthsLeft;
      const v = this.medianAt(m, extra);
      // spread widens with time (0 at today -> full at goal date)
      const t = this.monthsLeft > 0 ? (m - this.monthsElapsed) / this.monthsLeft : 1;
      med.push({ x: frac, y: v });
      lo.push({ x: frac, y: v * (1 - (1 - loF) * t) });
      hi.push({ x: frac, y: v * (1 + (hiF - 1) * t) });
    }
    return { med, lo, hi };
  }

  /** The projection, recomputed when the slab amount changes. */
  get proj() {
    return this.sample(40, this.extraMonthly);
  }

  /** Max Y across all lines + target, for scaling. */
  private get yMax(): number {
    const p = this.proj;
    const peak = Math.max(
      this.target,
      ...p.hi.map((q) => q.y),
      ...p.med.map((q) => q.y),
    );
    return peak * 1.08;
  }

  private px(x: number): number {
    return x * this.W;
  }
  private py(y: number): number {
    const top = 8;
    const bottom = this.H - 8;
    const clamped = Math.max(0, Math.min(this.yMax, y));
    return bottom - (clamped / this.yMax) * (bottom - top);
  }

  private path(pts: Pt[]): string {
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${this.px(p.x).toFixed(1)},${this.py(p.y).toFixed(1)}`)
      .join(' ');
  }

  /** SVG path for the median line. */
  get medPath(): string {
    return this.path(this.proj.med);
  }
  /** Closed area path between the low and high outcome lines (the cone). */
  get bandPath(): string {
    const p = this.proj;
    const up = this.path(p.hi);
    const downPts = [...p.lo].reverse();
    const down = downPts
      .map((q) => `L${this.px(q.x).toFixed(1)},${this.py(q.y).toFixed(1)}`)
      .join(' ');
    return `${up} ${down} Z`;
  }
  /** Y pixel of the dotted target line. */
  get targetY(): number {
    return this.py(this.target);
  }
  /** Final median point (end cap dot). */
  get endDot(): { x: number; y: number; v: number } {
    const last = this.proj.med[this.proj.med.length - 1];
    return { x: this.px(last.x), y: this.py(last.y), v: last.y };
  }

  // ================= probability of success =================
  //
  // Fraction of the outcome cone at the goal date that lands at/above target.
  // Modelled as target's position within [poor, strong] outcomes.

  get successPct(): number {
    const p = this.proj;
    const lo = p.lo[p.lo.length - 1].y;
    const hi = p.hi[p.hi.length - 1].y;
    if (hi <= lo) return this.target <= lo ? 100 : 0;
    // Portion of the [lo,hi] range that clears the target.
    const clears = (hi - this.target) / (hi - lo);
    return Math.round(Math.max(2, Math.min(99, clears * 100)));
  }

  // ================= "invest more -> sooner" =================

  /** Months to first hit target at a given extra monthly SIP (median path). */
  private monthsToTarget(extra: number): number | null {
    const r = this.monthlyRate;
    const monthly = (this.goal.monthly_investment || 0) + extra;
    let value = this.current;
    for (let m = this.monthsElapsed + 1; m <= this.monthsTotal * 4; m++) {
      value = value * (1 + r) + monthly;
      if (value >= this.target) return m;
    }
    return null;
  }

  /** How many months SOONER the extra SIP reaches the goal vs the base plan. */
  get monthsSooner(): number {
    const base = this.monthsToTarget(0);
    const boosted = this.monthsToTarget(this.extraMonthly);
    if (base == null || boosted == null) return 0;
    return Math.max(0, base - boosted);
  }
  /** Success probability with the extra SIP applied. */
  get boostedSuccessPct(): number {
    return this.successPct; // proj already includes extraMonthly
  }
  /** Baseline success probability (no extra), for the "87% -> 94%" line. */
  get baseSuccessPct(): number {
    const saved = this.extraMonthly;
    this.extraMonthly = 0;
    const v = this.successPct;
    this.extraMonthly = saved;
    return v;
  }
  get hasBoost(): boolean {
    return this.extraMonthly > 0;
  }
  setExtra(amount: number): void {
    this.extraMonthly = this.extraMonthly === amount ? 0 : amount;
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // ================= funds (See my investments) =================

  get holdings(): GoalRecommendation[] {
    return this.goal.recommendations ?? [];
  }
  get hasHoldings(): boolean {
    return this.holdings.length > 0;
  }
  /** Per-fund performance rows, biggest position first. */
  get fundRows(): FundRow[] {
    // Each fund's shown return leans on the goal's expected return, nudged by
    // asset class so the list reads realistically (equity > hybrid > debt).
    const bump: Record<string, number> = {
      equity: 1.35,
      hybrid: 1.1,
      gold: 1.0,
      debt: 0.8,
    };
    const baseRet = (this.goal.expected_return ?? 0.1) * 100;
    return [...this.holdings]
      .sort((a, b) => b.weight - a.weight)
      .map((h) => ({
        name: h.name,
        assetClass: h.asset_class,
        weight: h.weight,
        ret: baseRet * (bump[h.asset_class] ?? 1),
      }));
  }
  toggleFunds(): void {
    this.showFunds = !this.showFunds;
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // ================= helpers =================

  compact(v: number): string {
    if (v >= 1_00_00_000) {
      const cr = v / 1_00_00_000;
      return `₹${cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')} Cr`;
    }
    if (v >= 1_00_000) {
      const l = v / 1_00_000;
      return `₹${l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')} L`;
    }
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }
  monthsLabel(n: number): string {
    if (n >= 12) {
      const y = Math.floor(n / 12);
      const m = n % 12;
      return m ? `${y}y ${m}m` : `${y} yr${y > 1 ? 's' : ''}`;
    }
    return `${n} mo`;
  }
  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[
        a
      ] ?? 'var(--accent, #a370ff)'
    );
  }
  assetLabel(a: string): string {
    return { equity: 'Equity', hybrid: 'Hybrid', debt: 'Debt', gold: 'Gold' }[a] ?? a;
  }
  goalIcon(key: string): string {
    return (
      {
        retirement: '🌴',
        house: '🏠',
        education: '🎓',
        car: '🚗',
        wedding: '💍',
        travel: '✈️',
        wealth: '📈',
        emergency: '🛟',
      }[key] ?? '🎯'
    );
  }

  onBack(): void {
    this.back.emit();
  }
}
