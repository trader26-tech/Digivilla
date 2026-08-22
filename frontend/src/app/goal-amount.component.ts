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

import { GoalPreset } from './models';

/**
 * Second screen of the no-login flow: "Choose your goal amount".
 *
 * The amount is set with a circular knob the user drags around a dial — the big
 * number in the centre animates as it changes, with a light haptic tick on
 * capable devices (no sound). An "Enter amount" button flips to a numeric dialer
 * for typing an exact figure; its Back button flips back to the knob. Either
 * path feeds the same `amount`, and Continue emits it.
 */
@Component({
  selector: 'app-goal-amount',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goal-amount.component.html',
  styleUrl: './goal-amount.component.scss',
})
export class GoalAmountComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) goal!: GoalPreset;
  @Output() amountChosen = new EventEmitter<number>();
  @Output() back = new EventEmitter<void>();

  @ViewChild('dial') dialRef!: ElementRef<HTMLElement>;

  /**
   * Arch geometry, in the SVG's 320x220 viewBox. The dial is a big circle
   * centred well below the band, so only its top cap shows as a dome. The user
   * drags along that top edge. Angles are measured from the centre, 0deg =
   * straight up, positive = clockwise (to the right). The usable arc is a
   * symmetric window HALF either side of vertical.
   */
  readonly CX = 160;
  readonly CY = 320;
  readonly R = 300;
  readonly HALF = 28; // degrees either side of top -> a wide arc that fits the band

  /** Accent hue for this goal — same map as the colourful goal picker, so the
   *  amount screen inherits the goal's colour (house=blue, wealth=green, …). */
  get hue(): number {
    return HUE_OF[this.goal?.key] ?? 222;
  }

  min = 0;
  max = 0;
  step = 0;
  amount = 0;        // committed target value
  displayAmount = 0; // what the UI renders — tweens toward `amount`

  entered = false;   // drives the entry animation classes
  popKey = 0;        // bumped on each step so the number can re-trigger its pop

  dialerOpen = false;
  dialerValue = ''; // digits typed in the numeric dialer

  private dragging = false;
  private lastTickAmount = 0;
  private reduceMotion = false;
  private tweenRAF = 0;

  // Bound handlers so we can add/remove the same references.
  private moveH = (e: PointerEvent) => this.onPointerMove(e);
  private upH = () => this.endDrag();

  ngAfterViewInit(): void {
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.setupRange();
    this.runEntry();
  }

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.moveH);
    window.removeEventListener('pointerup', this.upH);
    cancelAnimationFrame(this.tweenRAF);
  }

  /** Entry choreography: count the number up to its start value and let the
   *  dome/ticks animate in (CSS handles those via the `entered` class). */
  private runEntry(): void {
    if (this.reduceMotion) {
      this.displayAmount = this.amount;
      this.entered = true;
      return;
    }
    // Start the number lower (never at zero) and count up to the real value.
    this.displayAmount = this.min + (this.amount - this.min) * 0.55;
    // Next frame, flip `entered` so CSS transitions kick in, and tween up.
    requestAnimationFrame(() => {
      this.entered = true;
      this.tweenTo(this.amount, 900);
    });
  }

  /** Derive a friendly [min,max,step] range from the goal's suggestions. */
  private setupRange(): void {
    const sugg = (this.goal.suggested_amounts || []).filter((n) => n > 0);
    const lo = sugg.length ? Math.min(...sugg) : this.goal.default_amount * 0.25;
    const hi = sugg.length ? Math.max(...sugg) : this.goal.default_amount * 2;
    // Pad the range a little so the default sits comfortably inside it and the
    // user can go both below and above the suggested band. The minimum is never
    // zero — the dial always starts on a real, meaningful amount.
    this.min = Math.max(this.niceFloor(lo * 0.5), this.niceStep(lo * 0.1));
    this.max = this.niceCeil(hi * 1.5);
    // ~200 steps across the dial keeps dragging smooth but snappy.
    this.step = this.niceStep((this.max - this.min) / 200);
    this.amount = this.clampSnap(this.goal.default_amount || (this.min + this.max) / 2);
    this.lastTickAmount = this.amount;
  }

  // ---------- arch math ----------

  /** Fraction 0..1 of the RENDERED (tweened) amount within [min,max].
   *  Handle + arc follow this so they glide with chip taps / entry. */
  get fraction(): number {
    const f = (this.displayAmount - this.min) / (this.max - this.min || 1);
    return Math.max(0, Math.min(1, f));
  }

  /** A point on the dome's top edge for a given fraction (0 = left, 1 = right). */
  private pointAt(frac: number): { x: number; y: number } {
    const deg = -this.HALF + frac * (2 * this.HALF); // -HALF..+HALF, 0 = top
    const rad = ((deg - 90) * Math.PI) / 180; // -90 shifts 0deg to straight up
    return { x: this.CX + this.R * Math.cos(rad), y: this.CY + this.R * Math.sin(rad) };
  }

  /** The draggable handle position for the current amount. */
  get handlePt(): { x: number; y: number } {
    return this.pointAt(this.fraction);
  }

  /** True for the public template so it can add a `.dragging` class. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** SVG path for the arc from the left edge up to `frac` along the top edge. */
  arcPath(frac: number): string {
    const a = this.pointAt(0);
    const b = this.pointAt(Math.max(0.0001, frac));
    // Small arc, sweep clockwise (1) since we go left -> right over the top.
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${this.R} ${this.R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }

  // ---------- pointer handling ----------

  startDrag(e: PointerEvent): void {
    e.preventDefault();
    this.dragging = true;
    window.addEventListener('pointermove', this.moveH);
    window.addEventListener('pointerup', this.upH);
    this.applyPointer(e); // let a tap on the ring jump straight to that value
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragging) this.applyPointer(e);
  }

  private endDrag(): void {
    this.dragging = false;
    window.removeEventListener('pointermove', this.moveH);
    window.removeEventListener('pointerup', this.upH);
  }

  /** Convert a pointer position on the dial into an amount.
   *
   *  The arch is wide and shallow, so the intuitive mapping is simply the
   *  pointer's HORIZONTAL position: drag right -> value up, drag left -> value
   *  down, one-to-one, no inversion. We map the finger's x across the arc's
   *  visible horizontal span (its left end .. right end) to the 0..1 fraction.
   */
  private applyPointer(e: PointerEvent): void {
    const el = this.dialRef?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;

    // Horizontal span of the arch's endpoints, as a fraction of element width.
    // pointAt(0).x and pointAt(1).x live in the 320-wide viewBox; convert to
    // the same 0..1 space the pointer uses across the element.
    const VW = 320;
    const scale = Math.max(rect.width / VW, rect.height / 220);
    const offsetX = (rect.width - VW * scale) / 2;
    const leftX = offsetX + this.pointAt(0).x * scale;
    const rightX = offsetX + this.pointAt(1).x * scale;

    const x = e.clientX - rect.left;
    let frac = (x - leftX) / (rightX - leftX || 1);
    frac = Math.max(0, Math.min(1, frac));

    const raw = this.min + frac * (this.max - this.min);
    this.setAmount(raw);
  }

  // ---------- amount setters + feedback ----------

  /** Set the amount. During a drag this tracks 1:1 (no tween) so the handle
   *  stays under the finger; otherwise the display glides to the new value. */
  setAmount(raw: number, animate = false): void {
    const snapped = this.clampSnap(raw);
    if (snapped === this.amount) return;
    this.amount = snapped;
    this.popKey++;
    this.tickFeedback();
    if (animate && !this.reduceMotion) {
      this.tweenTo(snapped, 420);
    } else {
      cancelAnimationFrame(this.tweenRAF);
      this.displayAmount = snapped;
    }
  }

  /** Smoothly animate `displayAmount` toward a target over `dur` ms. */
  private tweenTo(target: number, dur: number): void {
    cancelAnimationFrame(this.tweenRAF);
    const from = this.displayAmount;
    const delta = target - from;
    if (Math.abs(delta) < 1) {
      this.displayAmount = target;
      return;
    }
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      this.displayAmount = from + delta * ease(t);
      if (t < 1) {
        this.tweenRAF = requestAnimationFrame(frame);
      } else {
        this.displayAmount = target;
      }
    };
    this.tweenRAF = requestAnimationFrame(frame);
  }

  nudge(dir: number): void {
    this.setAmount(this.amount + dir * this.step, true);
  }

  pickSuggested(v: number): void {
    this.setAmount(v, true); // handle glides along the arch to the chosen value
  }

  private clampSnap(v: number): number {
    const snapped = Math.round(v / this.step) * this.step;
    return Math.max(this.min, Math.min(this.max, snapped));
  }

  /** Light haptic tick on each step (no sound). Silently skipped on devices
   *  without a vibration motor (all desktops, iOS Safari). */
  private tickFeedback(): void {
    const delta = Math.abs(this.amount - this.lastTickAmount);
    if (delta >= this.step * 0.99) {
      this.lastTickAmount = this.amount;
      if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(6);
    }
  }

  // ---------- numeric dialer ----------

  openDialer(): void {
    this.dialerValue = String(Math.round(this.amount));
    this.dialerOpen = true;
  }

  closeDialer(commit: boolean): void {
    if (commit) {
      const v = parseInt(this.dialerValue || '0', 10);
      if (v > 0) this.setAmount(v, true); // value flows back onto the arch
    }
    this.dialerOpen = false;
  }

  pressKey(k: string): void {
    if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(6);
    if (k === 'back') {
      this.dialerValue = this.dialerValue.slice(0, -1);
    } else if (k === '000') {
      if (this.dialerValue && this.dialerValue !== '0') this.dialerValue += '000';
    } else {
      if (this.dialerValue === '0') this.dialerValue = '';
      if (this.dialerValue.length < 12) this.dialerValue += k;
    }
  }

  get dialerDisplay(): string {
    const v = parseInt(this.dialerValue || '0', 10);
    return v > 0 ? v.toLocaleString('en-IN') : '0';
  }

  // ---------- formatting + emit ----------
  // These render `displayAmount` (the tweened value) so the number visibly
  // counts during entry, chip taps and dialer commits.

  /** Big compact label, e.g. ₹2 Cr, ₹50 L. */
  get compact(): string {
    return this.compactInr(this.displayAmount);
  }

  /** Full grouped figure — the headline number. */
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

  /** Motivating hand-off: on Next we show a brief encouraging card, then
   *  continue. `cheer` drives the overlay; the message adapts to the goal. */
  cheering = false;

  get cheerTitle(): string {
    return 'Great goal!';
  }
  get cheerBody(): string {
    const label = (this.goal?.label || 'this goal').toLowerCase();
    return `Reaching ${label} is more within reach than it looks. With a steady monthly plan, we'll help you get there — one step at a time.`;
  }

  confirm(): void {
    if (this.cheering) return;
    if (navigator.vibrate && !this.reduceMotion) navigator.vibrate([10, 30, 10]);
    this.cheering = true;
    const wait = this.reduceMotion ? 350 : 1700;
    window.setTimeout(() => this.amountChosen.emit(Math.round(this.amount)), wait);
  }

  // ---------- "nice number" helpers ----------

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

/** Per-goal accent hue — kept in sync with goal-picker's HUE_OF so a goal's
 *  colour carries through from the picker into the amount screen. */
const HUE_OF: Record<string, number> = {
  retirement: 28,
  child_education: 262,
  house: 222,
  car: 190,
  wealth: 150,
  emergency: 356,
  wedding: 330,
  vacation: 205,
};
