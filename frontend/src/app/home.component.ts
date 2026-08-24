import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
} from '@angular/core';

import { inr } from './format';
import { Goal } from './models';
import { PlannerService } from './planner.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnChanges {
  @Input() refreshKey = 0;
  @Output() planNew = new EventEmitter<void>();
  @Output() exploreFunds = new EventEmitter<void>();

  goals: Goal[] = [];
  loading = true;

  /** Which goal is expanded to full detail (id), or null. */
  openId: string | null = null;

  constructor(private api: PlannerService) {}

  ngOnInit(): void {
    this.load();
  }
  ngOnChanges(): void {
    if (!this.loading) this.load();
  }

  load(): void {
    this.loading = true;
    this.api.goals().subscribe({
      next: (g) => {
        this.goals = g;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  toggle(g: Goal): void {
    this.openId = this.openId === g.id ? null : g.id;
    if (navigator.vibrate) navigator.vibrate(5);
  }
  isOpen(g: Goal): boolean {
    return this.openId === g.id;
  }

  remove(g: Goal, ev: Event): void {
    ev.stopPropagation();
    this.api.deleteGoal(g.id).subscribe(() => {
      this.goals = this.goals.filter((x) => x.id !== g.id);
      if (this.openId === g.id) this.openId = null;
    });
  }

  // ================= PORTFOLIO HERO =================

  /** Total the user has actually put in across all goals. */
  get totalInvested(): number {
    return this.goals.reduce((s, g) => s + g.progress.invested_so_far, 0);
  }
  /** Current worth today (invested + market growth so far). */
  get totalCurrent(): number {
    return this.goals.reduce((s, g) => s + g.progress.on_track_value, 0);
  }
  /** Absolute gain so far. */
  get totalGain(): number {
    return Math.max(0, this.totalCurrent - this.totalInvested);
  }
  /** Portfolio XIRR — value-weighted blend of each goal's annualised return. */
  get portfolioXirr(): number {
    const cur = this.totalCurrent;
    if (cur <= 0) return 0;
    const weighted = this.goals.reduce(
      (s, g) => s + this.goalXirr(g) * g.progress.on_track_value,
      0,
    );
    return weighted / cur;
  }

  /** Per-goal XIRR (annualised). The plan's expected return IS the goal's XIRR
   *  here, since current value is derived from it; shown as a %. */
  goalXirr(g: Goal): number {
    return (g.expected_return ?? 0) * 100;
  }

  // ================= PER-GOAL NUMBERS =================

  invested(g: Goal): number {
    return g.progress.invested_so_far;
  }
  current(g: Goal): number {
    return g.progress.on_track_value;
  }
  /** How much of the target is still to go (from current value). */
  toGo(g: Goal): number {
    return Math.max(0, g.target_amount - g.progress.on_track_value);
  }
  reachedPct(g: Goal): number {
    if (g.target_amount <= 0) return 0;
    return this.clampPct((g.progress.on_track_value / g.target_amount) * 100);
  }

  // ---- "what if I add ₹X extra per month" ----
  /** Extra monthly top-up the user is exploring, per goal id. */
  topUp: Record<string, number> = {};
  topUpSteps = [1000, 2500, 5000, 10000];

  extra(g: Goal): number {
    return this.topUp[g.id] || 0;
  }
  setExtra(g: Goal, amount: number, ev: Event): void {
    ev.stopPropagation();
    this.topUp[g.id] = this.extra(g) === amount ? 0 : amount;
    if (navigator.vibrate) navigator.vibrate(4);
  }
  /** Projected FINAL value if they add `extra` more per month from now to goal end. */
  whatIfFinal(g: Goal): number {
    const base = g.projected_p50 || g.target_amount;
    const extra = this.extra(g);
    if (extra <= 0) return base;
    const monthsLeft = Math.max(0, g.progress.months_total - g.progress.months_elapsed);
    const r = (1 + (g.expected_return ?? 0.1)) ** (1 / 12) - 1;
    const fvExtra =
      r > 0 ? extra * (((1 + r) ** monthsLeft - 1) / r) * (1 + r) : extra * monthsLeft;
    return base + fvExtra;
  }
  whatIfBoost(g: Goal): number {
    return Math.max(0, this.whatIfFinal(g) - (g.projected_p50 || g.target_amount));
  }

  // ================= helpers =================
  fmt = inr;

  /** Compact INR for big hero numbers: ₹1.8 Cr / ₹28.3 L / ₹8,000. */
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
  pct(v: number): string {
    return `${Math.round(v)}%`;
  }

  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[a] ??
      'var(--accent, #a370ff)'
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

  trackById(_i: number, g: Goal): string {
    return g.id;
  }
}
