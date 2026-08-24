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

/** A point on the growth curve. x is 0..1 across the chart; values in rupees. */
interface Pt {
  x: number;
  invested: number; // cumulative SIP contributions
  value: number;    // contributions + market growth
}

/** One mutual fund and how it has performed for this goal. */
interface FundRow {
  name: string;
  assetClass: string;
  weight: number; // 0..1
  ret: number; // annualised %, this fund's contribution
}

/**
 * Single-goal detail, built around ONE clear SIP-growth chart.
 *
 * The chart projects a monthly SIP from today to the goal: a stacked area of
 * what YOU put in (contributions) vs what the MARKET adds (returns), climbing
 * to a dotted goal line, with a marker showing WHEN the goal is reached.
 * A "invest more" control redraws the curve reaching the goal sooner and
 * splits the extra into contributions vs returns. Works even at ₹0 invested,
 * because it's a projection of the plan — which is exactly what an SIP investor
 * wants to see before (and while) they invest.
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

  /** Extra monthly SIP the user is exploring. */
  extraMonthly = 0;
  monthlySteps = [1000, 2500, 5000, 10000];

  /** Whether the "See my investments" fund list is expanded. */
  showFunds = false;

  /** Flips true a beat after load so the chart areas animate in. */
  drawn = false;

  // chart geometry (viewBox units)
  readonly W = 320;
  readonly H = 190;
  private readonly PAD_T = 10;
  private readonly PAD_B = 10;

  ngOnChanges(): void {
    this.extraMonthly = 0;
    this.showFunds = false;
    this.drawn = false;
    setTimeout(() => (this.drawn = true), 80);
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
  get baseMonthly(): number {
    return this.goal.monthly_investment || 0;
  }
  /** The monthly SIP being modelled (base + any extra the user picked). */
  get planMonthly(): number {
    return this.baseMonthly + this.extraMonthly;
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

  // ================= SIP growth model =================
  //
  // From today, project the SIP month by month:
  //   value_next  = value * (1 + r) + monthly        (contributions grow)
  //   invested   += monthly                          (money you put in)
  // We start from what's already accrued (`current` value, `invested` so far).

  /** How long we draw the curve: to the goal date, but extended a bit past it
   *  if the goal isn't reached by then (so the "reached" point is visible). */
  private get horizonMonths(): number {
    const reach = this.reachMonthAbs(this.extraMonthly);
    const base = this.monthsTotal;
    if (reach == null) return base;
    // draw at least to the goal date, and up to ~10% past the reach point
    return Math.max(base, Math.ceil(reach * 1.05));
  }

  /** Absolute month index (from the plan start) when the target is first hit
   *  at a given extra SIP, or null if not within 4× the horizon. */
  private reachMonthAbs(extra: number): number | null {
    const r = this.monthlyRate;
    const monthly = this.baseMonthly + extra;
    let value = this.current;
    const cap = this.monthsTotal * 4 + 12;
    for (let m = this.monthsElapsed + 1; m <= cap; m++) {
      value = value * (1 + r) + monthly;
      if (value >= this.target) return m;
    }
    return null;
  }

  /** The projected curve (invested + value), recomputed with extraMonthly. */
  private curve(extra = this.extraMonthly): Pt[] {
    const r = this.monthlyRate;
    const monthly = this.baseMonthly + extra;
    const total = Math.max(1, this.horizonMonths);
    const STEPS = 48;
    const pts: Pt[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const m = this.monthsElapsed + (i / STEPS) * (total - this.monthsElapsed);
      const grown = i / STEPS; // fraction of remaining journey
      const contribMonths = Math.max(0, m - this.monthsElapsed);
      // closed-form SIP future value from today
      const fv =
        r > 0
          ? monthly * (((1 + r) ** contribMonths - 1) / r) * (1 + r)
          : monthly * contribMonths;
      const grownStart = this.current * (1 + r) ** contribMonths;
      const value = grownStart + fv;
      const invested = this.invested + monthly * contribMonths;
      pts.push({ x: i / STEPS, invested, value });
      void grown;
    }
    return pts;
  }

  get proj(): Pt[] {
    return this.curve();
  }

  private get yMax(): number {
    const peak = Math.max(this.target, ...this.proj.map((p) => p.value));
    return peak * 1.06;
  }

  private px(x: number): number {
    return x * this.W;
  }
  private py(v: number): number {
    const top = this.PAD_T;
    const bottom = this.H - this.PAD_B;
    const c = Math.max(0, Math.min(this.yMax, v));
    return bottom - (c / this.yMax) * (bottom - top);
  }

  /** Area path under the invested (contributions) line -> baseline. */
  get investedArea(): string {
    const p = this.proj;
    const top = p
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${this.px(q.x).toFixed(1)},${this.py(q.invested).toFixed(1)}`)
      .join(' ');
    const base = this.H - this.PAD_B;
    return `${top} L${this.W},${base} L0,${base} Z`;
  }
  /** Area between invested and total value = the market's contribution. */
  get returnsArea(): string {
    const p = this.proj;
    const top = p
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${this.px(q.x).toFixed(1)},${this.py(q.value).toFixed(1)}`)
      .join(' ');
    const bottom = [...p]
      .reverse()
      .map((q) => `L${this.px(q.x).toFixed(1)},${this.py(q.invested).toFixed(1)}`)
      .join(' ');
    return `${top} ${bottom} Z`;
  }
  /** The total-value line on top of the areas. */
  get valueLine(): string {
    return this.proj
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${this.px(q.x).toFixed(1)},${this.py(q.value).toFixed(1)}`)
      .join(' ');
  }
  get investedLine(): string {
    return this.proj
      .map((q, i) => `${i === 0 ? 'M' : 'L'}${this.px(q.x).toFixed(1)},${this.py(q.invested).toFixed(1)}`)
      .join(' ');
  }

  /** Y pixel of the dotted goal line. */
  get targetY(): number {
    return this.py(this.target);
  }

  /** Where the total-value curve crosses the target (the "reached" marker). */
  get reachDot(): { x: number; y: number; show: boolean } {
    const reach = this.reachMonthAbs(this.extraMonthly);
    if (reach == null) return { x: 0, y: 0, show: false };
    const total = this.horizonMonths;
    const frac = (reach - this.monthsElapsed) / (total - this.monthsElapsed || 1);
    return { x: this.px(Math.min(1, Math.max(0, frac))), y: this.targetY, show: true };
  }

  // ================= reach / totals =================

  /** Months from today until the goal is reached at the current SIP. */
  get reachInMonths(): number | null {
    const abs = this.reachMonthAbs(this.extraMonthly);
    return abs == null ? null : Math.max(0, abs - this.monthsElapsed);
  }
  /** A friendly "reach date": e.g. "Aug 2031" style via month offset label. */
  get reachLabel(): string {
    const m = this.reachInMonths;
    if (m == null) return 'Beyond plan';
    return this.monthsLabel(m);
  }

  /** Projected total at the goal date (contributions + returns). */
  get projectedTotal(): number {
    const p = this.proj;
    const atGoal =
      this.horizonMonths <= this.monthsTotal
        ? p[p.length - 1]
        : p[Math.min(p.length - 1, Math.round((this.monthsTotal - this.monthsElapsed) / (this.horizonMonths - this.monthsElapsed) * (p.length - 1)))];
    return atGoal.value;
  }
  /** Split of the projected total at goal date. */
  get contribAtGoal(): number {
    const perMonth = this.planMonthly;
    return this.invested + perMonth * this.monthsLeft;
  }
  get returnsAtGoal(): number {
    return Math.max(0, this.projectedTotal - this.contribAtGoal);
  }

  // ================= "invest more -> sooner" =================

  get hasBoost(): boolean {
    return this.extraMonthly > 0;
  }
  /** How many months SOONER the extra SIP reaches the goal vs the base plan. */
  get monthsSooner(): number {
    const base = this.reachMonthAbs(0);
    const boosted = this.reachMonthAbs(this.extraMonthly);
    if (base == null || boosted == null) return 0;
    return Math.max(0, base - boosted);
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
  get fundRows(): FundRow[] {
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
