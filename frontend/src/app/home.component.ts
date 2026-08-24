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

/** Selectable time ranges for the portfolio chart. */
type Range = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnChanges {
  @Input() refreshKey = 0;
  @Input() userName = '';
  @Output() planNew = new EventEmitter<void>();
  @Output() exploreFunds = new EventEmitter<void>();
  @Output() signOut = new EventEmitter<void>();
  /** Tapping a goal card opens its full detail page (handled by AppComponent). */
  @Output() openGoal = new EventEmitter<Goal>();

  goals: Goal[] = [];
  loading = true;

  ranges: Range[] = ['1D', '1W', '1M', '3M', '6M', '1Y'];
  range: Range = '1Y';

  /** Animated count-up for the big total. */
  animCurrent = 0;
  private raf = 0;

  // main chart geometry
  readonly CW = 320;
  readonly CH = 96;

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
        this.animateTotal();
      },
      error: () => (this.loading = false),
    });
  }

  // ================= identity =================

  get firstName(): string {
    return (this.userName || '').trim().split(/\s+/)[0] || 'there';
  }
  get handle(): string {
    const n = (this.userName || '').trim().toLowerCase().replace(/\s+/g, '_');
    return n ? `@${n}` : '@investor';
  }
  get initials(): string {
    const parts = (this.userName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '👤';
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  // ================= portfolio totals =================

  get totalInvested(): number {
    return this.goals.reduce((s, g) => s + g.progress.invested_so_far, 0);
  }
  get totalCurrent(): number {
    return this.goals.reduce((s, g) => s + g.progress.on_track_value, 0);
  }
  get totalGain(): number {
    return this.totalCurrent - this.totalInvested;
  }
  get totalGainPct(): number {
    return this.totalInvested > 0 ? (this.totalGain / this.totalInvested) * 100 : 0;
  }
  get hasGoals(): boolean {
    return this.goals.length > 0;
  }

  /** Value gained over the selected window (approx, from the chart series). */
  get windowGain(): number {
    const s = this.series;
    if (s.length < 2) return 0;
    return s[s.length - 1] - s[0];
  }
  get windowGainPct(): number {
    const s = this.series;
    if (s.length < 2 || s[0] <= 0) return 0;
    return (this.windowGain / s[0]) * 100;
  }
  get windowLabel(): string {
    return (
      {
        '1D': 'Today',
        '1W': 'This week',
        '1M': 'This month',
        '3M': '3 months',
        '6M': '6 months',
        '1Y': 'This year',
      } as Record<Range, string>
    )[this.range];
  }

  // ================= main portfolio chart =================
  //
  // We synthesise a smooth portfolio-value curve ending at today's total. The
  // shape scales with the selected range (more wobble over longer windows), so
  // the chart feels alive like a real markets view. Deterministic (seeded by
  // index) so it doesn't jump on every change-detection tick.

  private rangePoints(r: Range): number {
    return { '1D': 24, '1W': 28, '1M': 30, '3M': 36, '6M': 40, '1Y': 48 }[r];
  }
  /** How much of the total gain the window represents (rough, for realism). */
  private rangeGainFrac(r: Range): number {
    return { '1D': 0.01, '1W': 0.03, '1M': 0.08, '3M': 0.2, '6M': 0.4, '1Y': 0.85 }[r];
  }

  /** The portfolio value series for the selected range (rupees). */
  get series(): number[] {
    const end = this.totalCurrent;
    if (end <= 0) return [0, 0];
    const n = this.rangePoints(this.range);
    const start = Math.max(0, end - this.totalGain * this.rangeGainFrac(this.range));
    const amp = (end - start) * 0.28 + end * 0.008;
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const trend = start + (end - start) * t;
      // layered sine wobble, seeded by i so it's stable
      const wob =
        Math.sin(i * 0.9) * amp * 0.5 +
        Math.sin(i * 0.37 + 1.3) * amp * 0.32 +
        Math.sin(i * 2.1 + 0.7) * amp * 0.18;
      out.push(Math.max(0, trend + wob * (0.35 + t * 0.65)));
    }
    out[out.length - 1] = end; // land exactly on today's value
    return out;
  }

  private seriesPath(vals: number[], w: number, h: number): string {
    if (vals.length < 2) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const pad = 6;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = pad + (1 - (v - min) / span) * (h - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  get chartLine(): string {
    return this.seriesPath(this.series, this.CW, this.CH);
  }
  get chartArea(): string {
    const line = this.chartLine;
    if (!line) return '';
    return `${line} L${this.CW},${this.CH} L0,${this.CH} Z`;
  }
  get chartUp(): boolean {
    return this.windowGain >= 0;
  }

  setRange(r: Range): void {
    this.range = r;
    if (navigator.vibrate) navigator.vibrate(3);
  }

  // ================= per-goal =================

  invested(g: Goal): number {
    return g.progress.invested_so_far;
  }
  current(g: Goal): number {
    return g.progress.on_track_value;
  }
  goalGainPct(g: Goal): number {
    const inv = g.progress.invested_so_far;
    if (inv <= 0) return 0;
    return ((g.progress.on_track_value - inv) / inv) * 100;
  }
  reachedPct(g: Goal): number {
    if (g.target_amount <= 0) return 0;
    return this.clampPct((g.progress.on_track_value / g.target_amount) * 100);
  }

  /** A tiny sparkline for a goal card — its value trajectory to today. */
  goalSpark(g: Goal): string {
    const end = g.progress.on_track_value;
    const start = g.progress.invested_so_far * 0.85;
    const n = 16;
    const amp = (end - start) * 0.25 + 1;
    const vals: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const trend = start + (end - start) * t;
      const wob = Math.sin(i * 1.1 + g.label.length) * amp * 0.5;
      vals.push(trend + wob * (0.3 + t * 0.7));
    }
    vals[vals.length - 1] = end;
    return this.seriesPath(vals, 72, 30);
  }

  open(g: Goal): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.openGoal.emit(g);
  }

  // ================= animation =================

  private animateTotal(): void {
    cancelAnimationFrame(this.raf);
    const target = this.totalCurrent;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.animCurrent = target * e;
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // ================= helpers =================
  fmt = inr;

  /** Full grouped rupees with paise split for the hero: ₹25,00,000 . 53 */
  heroWhole(v: number): string {
    return `₹${Math.floor(v).toLocaleString('en-IN')}`;
  }
  heroPaise(v: number): string {
    const p = Math.round((v - Math.floor(v)) * 100);
    return `.${p.toString().padStart(2, '0')}`;
  }

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
