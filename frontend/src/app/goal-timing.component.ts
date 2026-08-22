import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { GoalPreset } from './models';

/**
 * Third screen of the no-login flow: "When do you want to reach it?"
 *
 * The slider position (0..1) maps NON-LINEARLY onto a horizon in days, so the
 * short end (a week, a month, three months) gets fine control and the long end
 * (decades) compresses. As the slider moves, an accurate target DATE animates on
 * a calendar-style card. The label adapts to the scale: days -> weeks -> months
 * -> years, so a user can plan for two weeks or thirty years on the same track.
 */
@Component({
  selector: 'app-goal-timing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-timing.component.html',
  styleUrl: './goal-timing.component.scss',
})
export class GoalTimingComponent implements OnInit {
  @Input({ required: true }) goal!: GoalPreset;
  @Input() amount = 0;
  /** Emits the chosen horizon in YEARS (decimal ok, e.g. 0.04 for 2 weeks). */
  @Output() timingChosen = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  // The slider is a plain 0..1000 track; days are derived non-linearly from it.
  readonly TRACK = 1000;
  pos = 500; // slider position 0..TRACK

  // Horizon bounds in days: 7 days (a week) to ~40 years.
  private readonly MIN_DAYS = 7;
  private readonly MAX_DAYS = 365 * 40;

  entered = false;

  ngOnInit(): void {
    const defDays = Math.round((this.goal?.default_years || 10) * 365);
    this.pos = this.daysToPos(defDays);
    requestAnimationFrame(() => (this.entered = true));
  }

  get hue(): number {
    return HUE_OF[this.goal?.key] ?? 222;
  }

  // ---- non-linear mapping (exponential) ----
  /** slider position (0..TRACK) -> days, exponentially. */
  private posToDays(pos: number): number {
    const t = Math.max(0, Math.min(1, pos / this.TRACK));
    const days = this.MIN_DAYS * Math.pow(this.MAX_DAYS / this.MIN_DAYS, t);
    return Math.round(days);
  }
  /** days -> slider position (inverse of the above). */
  private daysToPos(days: number): number {
    const d = Math.max(this.MIN_DAYS, Math.min(this.MAX_DAYS, days));
    const t = Math.log(d / this.MIN_DAYS) / Math.log(this.MAX_DAYS / this.MIN_DAYS);
    return Math.round(t * this.TRACK);
  }

  get days(): number {
    return this.posToDays(this.pos);
  }
  /** Convenience: horizon expressed in whole months (>= 0). */
  get monthsTotal(): number {
    return Math.max(0, Math.round(this.days / 30.4375));
  }

  /** Bumped whenever the big unit's VALUE changes, to retrigger the pop pulse. */
  pulseKey = 0;
  private lastUnitValue = -1;

  onSlide(v: string): void {
    this.pos = Number(v);
    if (navigator.vibrate) navigator.vibrate(3);
    const val = this.bigUnit.value;
    if (val !== this.lastUnitValue) {
      this.lastUnitValue = val;
      this.pulseKey++;
    }
  }

  /** 0..1 fill fraction for the track tint (= normalized position). */
  get frac(): number {
    return this.pos / this.TRACK;
  }

  // ---- adaptive human label ----
  /** e.g. "2 weeks", "5 months", "9 years 6 months", "18 months". */
  get durationLabel(): string {
    const d = this.days;
    if (d < 14) return `${d} days`;
    if (d < 60) return `${Math.round(d / 7)} weeks`;
    if (d < 365 + 60) {
      const m = Math.round(d / 30.4375);
      return `${m} month${m > 1 ? 's' : ''}`;
    }
    const y = Math.floor(d / 365);
    const remM = Math.round((d % 365) / 30.4375);
    const yp = `${y} year${y > 1 ? 's' : ''}`;
    return remM ? `${yp} ${remM} mo` : yp;
  }

  /** A compact unit shown big under the calendar ("2 WEEKS", "5 MONTHS", "9 YRS"). */
  get bigUnit(): { value: number; unit: string } {
    const d = this.days;
    if (d < 14) return { value: d, unit: d === 1 ? 'DAY' : 'DAYS' };
    if (d < 60) {
      const w = Math.round(d / 7);
      return { value: w, unit: w === 1 ? 'WEEK' : 'WEEKS' };
    }
    if (d < 365 + 60) {
      const m = Math.round(d / 30.4375);
      return { value: m, unit: m === 1 ? 'MONTH' : 'MONTHS' };
    }
    const y = Math.round(d / 365);
    return { value: y, unit: y === 1 ? 'YEAR' : 'YEARS' };
  }

  // ---- live target date ----
  get targetDate(): Date {
    const d = new Date();
    d.setDate(d.getDate() + this.days);
    return d;
  }
  get targetMonthShort(): string {
    return this.targetDate.toLocaleString('en-US', { month: 'short' });
  }
  get targetDay(): number {
    return this.targetDate.getDate();
  }
  get targetYear(): number {
    return this.targetDate.getFullYear();
  }
  /** Show the day only for short horizons (a precise date matters for weeks). */
  get showDay(): boolean {
    return this.days < 365 + 60;
  }

  // ---- adaptive presets (labels change with the range) ----
  readonly presets = [
    { label: '2w', days: 14 },
    { label: '3mo', days: 91 },
    { label: '1y', days: 365 },
    { label: '5y', days: 365 * 5 },
    { label: '15y', days: 365 * 15 },
    { label: '30y', days: 365 * 30 },
  ];
  pick(days: number): void {
    this.pos = this.daysToPos(days);
    if (navigator.vibrate) navigator.vibrate(8);
  }
  isActive(days: number): boolean {
    // active if the slider lands within ~2% of this preset's position
    return Math.abs(this.pos - this.daysToPos(days)) <= this.TRACK * 0.02;
  }

  /** trackBy keyed on the value itself, so the *ngFor recreates the calendar
   *  value node each time the number changes — replaying the pop animation. */
  trackPulse(_: number, k: number): number {
    return k;
  }

  goBack(): void {
    this.back.emit();
  }
  confirm(): void {
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
    this.timingChosen.emit(+(this.days / 365).toFixed(3));
  }
}

const HUE_OF: Record<string, number> = {
  retirement: 28,
  child_education: 262,
  house: 222,
  car: 190,
  wealth: 150,
  emergency: 356,
  wedding: 330,
  vacation: 205,
  health: 168,
  gadget: 245,
};
