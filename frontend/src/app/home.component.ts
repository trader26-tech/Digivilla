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

  remove(g: Goal, ev: Event): void {
    ev.stopPropagation();
    this.api.deleteGoal(g.id).subscribe(() => (this.goals = this.goals.filter((x) => x.id !== g.id)));
  }

  // ----- aggregate stats -----
  get totalMonthly(): number {
    return this.goals.reduce((s, g) => s + g.monthly_investment, 0);
  }
  get totalTarget(): number {
    return this.goals.reduce((s, g) => s + g.target_amount, 0);
  }
  get totalInvested(): number {
    return this.goals.reduce((s, g) => s + g.progress.invested_so_far, 0);
  }
  get totalOnTrack(): number {
    return this.goals.reduce((s, g) => s + g.progress.on_track_value, 0);
  }

  // ----- helpers -----
  fmt = inr;

  pct(v: number): string {
    return `${Math.round(v)}%`;
  }
  clampPct(v: number): number {
    return Math.max(0, Math.min(100, v));
  }
  statusLabel(s: string): string {
    return (
      { new: 'Just started', on_track: 'On track', ahead: 'Ahead', behind: 'Behind' }[s] ??
      s
    );
  }
  statusTone(s: string): string {
    if (s === 'ahead' || s === 'on_track') return 'good';
    if (s === 'behind') return 'warn';
    return 'neutral';
  }
  assetColor(a: string): string {
    return (
      { equity: 'var(--eq)', hybrid: 'var(--hy)', debt: 'var(--dt)', gold: 'var(--gd)' }[a] ??
      'var(--accent)'
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
}
