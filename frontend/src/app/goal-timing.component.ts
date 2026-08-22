import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';

import { GoalPreset } from './models';

/**
 * Third screen of the no-login flow: "How long will you invest for this goal?"
 *
 * A horizontal slider sets the horizon in months. As it moves, the target DATE
 * updates live ("By August 2035") along with a friendly years-and-months label,
 * so the user feels time changing rather than reading an abstract number. The
 * goal's accent hue carries through from the picker/amount screens.
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
  /** Emits the chosen horizon in YEARS (decimal ok, e.g. 7.5). */
  @Output() timingChosen = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  readonly minMonths = 6;
  readonly maxMonths = 480; // 40 years
  months = 120;

  entered = false;

  ngOnInit(): void {
    const defYears = this.goal?.default_years || 10;
    this.months = Math.min(this.maxMonths, Math.max(this.minMonths, Math.round(defYears * 12)));
    requestAnimationFrame(() => (this.entered = true));
  }

  get hue(): number {
    return HUE_OF[this.goal?.key] ?? 222;
  }

  onSlide(v: string): void {
    this.months = Number(v);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  /** 0..1 position of the slider, for tinting the filled track. */
  get frac(): number {
    return (this.months - this.minMonths) / (this.maxMonths - this.minMonths);
  }

  get years(): number {
    return Math.floor(this.months / 12);
  }
  get remMonths(): number {
    return this.months % 12;
  }

  /** Short duration: "9y", "6mo", "9y 6mo". */
  get durationLabel(): string {
    const y = this.years;
    const m = this.remMonths;
    const yp = y ? `${y}y` : '';
    const mp = m ? `${m}mo` : '';
    return [yp, mp].filter(Boolean).join(' ') || '0mo';
  }

  /** The target date, computed from today + horizon. Updates live. */
  get targetDate(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() + this.months);
    return d;
  }
  get targetMonthName(): string {
    return this.targetDate.toLocaleString('en-US', { month: 'long' });
  }
  get targetMonthShort(): string {
    return this.targetDate.toLocaleString('en-US', { month: 'short' });
  }
  get targetYear(): number {
    return this.targetDate.getFullYear();
  }

  /** A few quick presets for common horizons. */
  readonly presets = [
    { label: '3y', months: 36 },
    { label: '5y', months: 60 },
    { label: '10y', months: 120 },
    { label: '20y', months: 240 },
    { label: '30y', months: 360 },
  ];
  pick(m: number): void {
    this.months = m;
    if (navigator.vibrate) navigator.vibrate(8);
  }
  isActive(m: number): boolean {
    return this.months === m;
  }

  goBack(): void {
    this.back.emit();
  }
  confirm(): void {
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
    this.timingChosen.emit(+(this.months / 12).toFixed(2));
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
