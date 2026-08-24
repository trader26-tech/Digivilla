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
import { RupiComponent } from './rupi.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RupiComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnChanges {
  @Input() refreshKey = 0;
  @Input() userName = '';
  @Output() planNew = new EventEmitter<void>();
  @Output() exploreFunds = new EventEmitter<void>();
  /** Tapping a goal card opens its full detail page (handled by AppComponent). */
  @Output() openGoal = new EventEmitter<Goal>();

  goals: Goal[] = [];
  loading = true;

  /** Animated count-up values for the hero (ease toward the real totals). */
  animCurrent = 0;
  animInvested = 0;
  animTarget = 0;
  private raf = 0;

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
        this.animateHero();
      },
      error: () => (this.loading = false),
    });
  }

  /** Ease the hero numbers up from 0 for a lively, premium reveal. */
  private animateHero(): void {
    cancelAnimationFrame(this.raf);
    const cur = this.totalCurrent;
    const inv = this.totalInvested;
    const tgt = this.totalTarget;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      this.animCurrent = cur * e;
      this.animInvested = inv * e;
      this.animTarget = tgt * e;
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** First name only, for a friendly greeting. */
  get firstName(): string {
    return (this.userName || '').trim().split(/\s+/)[0] || '';
  }
  /** Time-of-day greeting. */
  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  /** A goal exists but nothing invested yet -> "journey starts" framing. */
  get isFresh(): boolean {
    return this.goals.length > 0 && this.totalInvested < 1;
  }
  /** Combined target across all goals. */
  get totalTarget(): number {
    return this.goals.reduce((s, g) => s + g.target_amount, 0);
  }
  /** Combined monthly SIP across all goals. */
  get totalMonthly(): number {
    return this.goals.reduce((s, g) => s + (g.monthly_investment ?? 0), 0);
  }

  open(g: Goal): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.openGoal.emit(g);
  }

  remove(g: Goal, ev: Event): void {
    ev.stopPropagation();
    this.api.deleteGoal(g.id).subscribe(() => {
      this.goals = this.goals.filter((x) => x.id !== g.id);
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
