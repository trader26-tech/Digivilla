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

/** A single point on the invested-vs-value growth curve. */
interface GrowthPoint {
  month: number;
  invested: number;
  value: number;
}

/**
 * Full-screen detail for ONE goal. Opened when a goal card is tapped on Home.
 * Shows everything about that goal — how much is invested, how it has grown,
 * which funds it's in and at what concentration, any withdrawals, and a
 * what-if projector for a monthly top-up or a one-time lump sum.
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

  /** What the user is exploring: an extra monthly SIP, and/or a lump sum today. */
  extraMonthly = 0;
  lumpSum = 0;

  monthlySteps = [1000, 2500, 5000, 10000];
  lumpSteps = [10000, 50000, 100000, 500000];

  ngOnChanges(): void {
    // Reset the projector whenever a different goal opens.
    this.extraMonthly = 0;
    this.lumpSum = 0;
  }

  // ================= core numbers =================

  get invested(): number {
    return this.goal.progress.invested_so_far;
  }
  get current(): number {
    return this.goal.progress.on_track_value;
  }
  get gain(): number {
    return Math.max(0, this.current - this.invested);
  }
  get gainPct(): number {
    return this.invested > 0 ? (this.gain / this.invested) * 100 : 0;
  }
  /** Annualised return — the plan's expected return IS this goal's XIRR. */
  get xirr(): number {
    return (this.goal.expected_return ?? 0) * 100;
  }
  get toGo(): number {
    return Math.max(0, this.goal.target_amount - this.current);
  }
  get reachedPct(): number {
    if (this.goal.target_amount <= 0) return 0;
    return this.clampPct((this.current / this.goal.target_amount) * 100);
  }
  get monthsLeft(): number {
    return Math.max(
      0,
      this.goal.progress.months_total - this.goal.progress.months_elapsed,
    );
  }

  // ================= growth curve (invested vs value) =================

  /** Month-by-month invested vs on-track value, from start to today.
   *  Both are formula-derived (SIP contributions vs SIP future value). */
  get growthSeries(): GrowthPoint[] {
    const elapsed = Math.max(1, this.goal.progress.months_elapsed);
    const monthly = this.goal.monthly_investment || 0;
    const r = (1 + (this.goal.expected_return ?? 0.1)) ** (1 / 12) - 1;
    const pts: GrowthPoint[] = [];
    // Sample ~24 columns max so the bars stay legible on a phone.
    const step = Math.max(1, Math.ceil(elapsed / 24));
    for (let m = step; m <= elapsed; m += step) {
      const invested = monthly * m;
      const value =
        r > 0 ? monthly * (((1 + r) ** m - 1) / r) * (1 + r) : monthly * m;
      pts.push({ month: m, invested, value });
    }
    // Always include "today" as the final column.
    const last = pts[pts.length - 1];
    if (!last || last.month !== elapsed) {
      pts.push({ month: elapsed, invested: this.invested, value: this.current });
    }
    return pts;
  }

  /** Tallest value in the series, for scaling the bars. */
  get growthMax(): number {
    return this.growthSeries.reduce((m, p) => Math.max(m, p.value), 1);
  }
  barH(v: number): number {
    return this.clampPct((v / this.growthMax) * 100);
  }

  // ================= allocation / concentration =================

  get holdings(): GoalRecommendation[] {
    return this.goal.recommendations ?? [];
  }
  get hasHoldings(): boolean {
    return this.holdings.length > 0;
  }
  /** Holdings sorted by weight, biggest first — the "concentration" view. */
  get holdingsByWeight(): GoalRecommendation[] {
    return [...this.holdings].sort((a, b) => b.weight - a.weight);
  }
  /** The single largest position's weight, as a %. */
  get topConcentration(): number {
    if (!this.hasHoldings) return 0;
    return Math.max(...this.holdings.map((h) => h.weight)) * 100;
  }

  // ================= withdrawals =================

  /** No withdrawals are tracked yet for goals — this stays empty until the
   *  backend exposes a withdrawals history. Kept as a getter so the UI can
   *  simply switch to a populated state once data exists. */
  get withdrawals(): { date: string; amount: number; note?: string }[] {
    return [];
  }

  // ================= what-if projector =================

  /** Baseline projected finish with no extra investment. */
  get baseFinal(): number {
    return this.goal.projected_p50 || this.goal.target_amount;
  }

  /** Monthly compounding rate. */
  private get monthlyRate(): number {
    return (1 + (this.goal.expected_return ?? 0.1)) ** (1 / 12) - 1;
  }

  /** Future value of an extra ₹`extraMonthly` SIP from now to goal end. */
  private futureOfExtraMonthly(): number {
    const extra = this.extraMonthly;
    if (extra <= 0) return 0;
    const n = this.monthsLeft;
    const r = this.monthlyRate;
    return r > 0 ? extra * (((1 + r) ** n - 1) / r) * (1 + r) : extra * n;
  }

  /** Future value of a one-time lump sum invested today, grown to goal end. */
  private futureOfLump(): number {
    if (this.lumpSum <= 0) return 0;
    const n = this.monthsLeft;
    const r = this.monthlyRate;
    return this.lumpSum * (1 + r) ** n;
  }

  /** Total extra the goal finishes with, from both levers combined. */
  get whatIfBoost(): number {
    return this.futureOfExtraMonthly() + this.futureOfLump();
  }
  get whatIfFinal(): number {
    return this.baseFinal + this.whatIfBoost;
  }
  get hasWhatIf(): boolean {
    return this.extraMonthly > 0 || this.lumpSum > 0;
  }
  /** % lift over the baseline finish. */
  get whatIfLiftPct(): number {
    return this.baseFinal > 0 ? (this.whatIfBoost / this.baseFinal) * 100 : 0;
  }
  /** How much of the shortfall the boost closes (0..100). */
  get shortfallClosedPct(): number {
    const gap = Math.max(0, this.goal.target_amount - this.baseFinal);
    if (gap <= 0) return 100;
    return this.clampPct((this.whatIfBoost / gap) * 100);
  }

  setMonthly(amount: number): void {
    this.extraMonthly = this.extraMonthly === amount ? 0 : amount;
    this.buzz();
  }
  setLump(amount: number): void {
    this.lumpSum = this.lumpSum === amount ? 0 : amount;
    this.buzz();
  }
  clearWhatIf(): void {
    this.extraMonthly = 0;
    this.lumpSum = 0;
    this.buzz();
  }

  // ================= helpers =================
  fmt = inr;

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

  clampPct(v: number): number {
    return Math.max(0, Math.min(100, v));
  }

  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[
        a
      ] ?? 'var(--accent, #a370ff)'
    );
  }
  assetLabel(a: string): string {
    return (
      { equity: 'Equity', hybrid: 'Hybrid', debt: 'Debt', gold: 'Gold' }[a] ?? a
    );
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

  private buzz(): void {
    if (navigator.vibrate) navigator.vibrate(4);
  }

  onBack(): void {
    this.back.emit();
  }
}
