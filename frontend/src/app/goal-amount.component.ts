import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { GoalPreset } from './models';

/**
 * Second screen of the no-login flow: "How much for your goal?"
 *
 * Deliberately a matched pair with the timing screen: one big live number, one
 * horizontal slider (exponential, so both small and large amounts are easy to
 * reach), and a row of preset ticks. No typing required — but tapping the number
 * still opens the phone's native keypad as an optional shortcut.
 */
@Component({
  selector: 'app-goal-amount',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './goal-amount.component.html',
  styleUrl: './goal-amount.component.scss',
})
export class GoalAmountComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) goal!: GoalPreset;
  /** Starting amount from the goal-intro calculator; overrides default_amount. */
  @Input() preset = 0;
  @Output() amountChosen = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  @ViewChild('amountInput') amountInputRef?: ElementRef<HTMLInputElement>;

  /** Goal name for the heading. "Buy a House" -> "a House"; "Emergency Fund"
   *  -> "your Emergency Fund" — so it always reads naturally after "for". */
  get goalPhrase(): string {
    const label = this.goal?.label || 'this goal';
    const m = label.match(/^(Buy|Grow|Plan)\s+(.*)$/i);
    if (m) return m[2].replace(/^a\s+/i, 'a '); // "Buy a House" -> "a House"
    return `your ${label}`; // "Emergency Fund" -> "your Emergency Fund"
  }

  /** Accent hue for this goal — same map as the picker/timing screens. */
  get hue(): number {
    return HUE_OF[this.goal?.key] ?? 222;
  }

  // ---- slider track (exponential mapping, mirrors the timing screen) ----
  readonly TRACK = 1000;
  pos = 500; // slider position 0..TRACK

  min = 0;   // lowest amount reachable
  max = 0;   // highest amount reachable
  step = 0;  // rounding granularity

  amount = 0;        // committed target value
  displayAmount = 0; // rendered value (tweens toward `amount`)

  entered = false;
  popKey = 0;

  typing = false;
  typedDisplay = '';

  private reduceMotion = false;
  private tweenRAF = 0;
  private lastTickAmount = 0;

  ngAfterViewInit(): void {
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.setupRange();
    this.runEntry();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.tweenRAF);
  }

  private runEntry(): void {
    if (this.reduceMotion) {
      this.displayAmount = this.amount;
      this.entered = true;
      return;
    }
    this.displayAmount = this.min + (this.amount - this.min) * 0.55;
    requestAnimationFrame(() => {
      this.entered = true;
      this.tweenTo(this.amount, 900);
    });
  }

  /** Derive [min,max] from the goal's suggestions + the intro preset, then set
   *  the starting amount and slider position. */
  private setupRange(): void {
    const start = this.preset > 0 ? this.preset : this.goal.default_amount;
    const sugg = (this.goal.suggested_amounts || []).filter((n) => n > 0);
    let lo = sugg.length ? Math.min(...sugg) : start * 0.25;
    let hi = sugg.length ? Math.max(...sugg) : start * 2;
    lo = Math.min(lo, start);
    hi = Math.max(hi, start);
    this.min = Math.max(this.niceFloor(lo * 0.5), 1000);
    this.max = this.niceCeil(hi * 2);
    this.step = this.niceStep((this.max - this.min) / 400);
    this.amount = this.clampSnap(start || (this.min + this.max) / 2);
    this.lastTickAmount = this.amount;
    this.pos = this.amountToPos(this.amount);
  }

  // ---- exponential mapping between slider position and amount ----
  private posToAmount(pos: number): number {
    const t = Math.max(0, Math.min(1, pos / this.TRACK));
    const raw = this.min * Math.pow(this.max / this.min, t);
    return this.clampSnap(raw);
  }
  private amountToPos(amount: number): number {
    const a = Math.max(this.min, Math.min(this.max, amount));
    const t = Math.log(a / this.min) / Math.log(this.max / this.min || 1);
    return Math.round(t * this.TRACK);
  }

  /** 0..1 fill fraction for the track tint. */
  get sliderFrac(): number {
    return this.pos / this.TRACK;
  }

  onSlide(v: string): void {
    this.pos = Number(v);
    this.setAmount(this.posToAmount(this.pos), false);
  }

  // ---- preset ticks (centred on the recommended amount) ----
  get presetChips(): number[] {
    const base = this.preset > 0 ? this.preset : this.goal.default_amount;
    if (!base) return (this.goal.suggested_amounts || []).filter((n) => n > 0);
    const raw = [base * 0.5, base * 0.75, base, base * 1.5];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const v of raw) {
      const s = this.clampSnap(v);
      if (s > 0 && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }
  pickAmount(v: number): void {
    if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(8);
    this.pos = this.amountToPos(v);
    this.setAmount(v, true);
  }
  isTickActive(v: number): boolean {
    return Math.abs(this.pos - this.amountToPos(v)) <= this.TRACK * 0.02;
  }

  // ---- amount setter + tween ----
  setAmount(raw: number, animate = false): void {
    const snapped = this.clampSnap(raw);
    if (snapped === this.amount) return;
    this.amount = snapped;
    this.popKey++;
    this.tickFeedback();
    if (animate && !this.reduceMotion) {
      this.tweenTo(snapped, 300);
    } else {
      cancelAnimationFrame(this.tweenRAF);
      this.displayAmount = snapped;
    }
  }

  private tweenTo(target: number, dur: number): void {
    cancelAnimationFrame(this.tweenRAF);
    const from = this.displayAmount;
    const delta = target - from;
    if (Math.abs(delta) < 1) {
      this.displayAmount = target;
      return;
    }
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      this.displayAmount = from + delta * ease(t);
      if (t < 1) this.tweenRAF = requestAnimationFrame(frame);
      else this.displayAmount = target;
    };
    this.tweenRAF = requestAnimationFrame(frame);
  }

  private clampSnap(v: number): number {
    const snapped = Math.round(v / this.step) * this.step;
    return Math.max(this.min, Math.min(this.max, snapped));
  }

  private tickFeedback(): void {
    if (Math.abs(this.amount - this.lastTickAmount) >= this.step * 0.99) {
      this.lastTickAmount = this.amount;
      if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(4);
    }
  }

  // ---- optional native keypad ----
  startTyping(): void {
    this.typedDisplay = Math.round(this.amount).toLocaleString('en-IN');
    this.typing = true;
    setTimeout(() => {
      const el = this.amountInputRef?.nativeElement;
      if (el) {
        el.focus();
        const len = el.value.length;
        try { el.setSelectionRange(len, len); } catch {}
      }
    });
  }

  onTyped(v: string): void {
    const digits = (v || '').replace(/[^0-9]/g, '').slice(0, 12);
    const n = digits ? parseInt(digits, 10) : 0;
    this.typedDisplay = n ? n.toLocaleString('en-IN') : '';
    if (n > 0) {
      this.ensureInRange(n);
      this.setAmount(n, false);
      this.pos = this.amountToPos(this.amount);
    }
  }

  commitTyped(): void {
    if (!this.typing) return;
    const n = parseInt((this.typedDisplay || '0').replace(/[^0-9]/g, ''), 10);
    if (n > 0) {
      this.ensureInRange(n);
      this.setAmount(n, true);
      this.pos = this.amountToPos(this.amount);
    }
    this.typing = false;
    this.amountInputRef?.nativeElement.blur();
  }

  private ensureInRange(v: number): void {
    let changed = false;
    if (v < this.min) { this.min = Math.max(1000, this.niceFloor(v * 0.5)); changed = true; }
    if (v > this.max) { this.max = this.niceCeil(v * 1.25); changed = true; }
    if (changed) this.step = this.niceStep((this.max - this.min) / 400);
  }

  // ---- formatting ----
  get compact(): string {
    return this.compactInr(this.displayAmount);
  }
  get full(): string {
    return '₹' + Math.round(this.displayAmount).toLocaleString('en-IN');
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

  /** Continue -> carry the chosen amount to the timing screen. Nothing is saved
   *  here; that only happens at the very end of the flow. */
  confirm(): void {
    if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(8);
    this.amountChosen.emit(Math.round(this.amount));
  }

  // ---- "nice number" helpers ----
  private niceStep(x: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(x)));
    const n = x / pow;
    const nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return Math.max(1000, nice * pow);
  }
  private niceFloor(x: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(x)));
    return Math.floor(x / pow) * pow;
  }
  private niceCeil(x: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(x)));
    return Math.ceil(x / pow) * pow;
  }
}

/** Per-goal accent hue — kept in sync with the picker/timing screens. */
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
