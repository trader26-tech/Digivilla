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
 * number in the centre animates as it changes, with optional haptic + audio
 * tick feedback. An "Enter amount" button flips to a numeric dialer for typing
 * an exact figure; its Back button flips back to the knob. Either path feeds the
 * same `amount`, and Continue emits it.
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

  /** Knob geometry. Angle sweeps from -135deg to +135deg (a 270deg gauge). */
  readonly START = -135;
  readonly SWEEP = 270;

  min = 0;
  max = 0;
  step = 0;
  amount = 0;

  dialerOpen = false;
  dialerValue = ''; // digits typed in the numeric dialer
  muted = false;

  private dragging = false;
  private audioCtx: AudioContext | null = null;
  private lastTickAmount = 0;
  private reduceMotion = false;

  // Bound handlers so we can add/remove the same references.
  private moveH = (e: PointerEvent) => this.onPointerMove(e);
  private upH = () => this.endDrag();

  ngAfterViewInit(): void {
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.muted = localStorage.getItem('wp_knob_muted') === '1';
    this.setupRange();
  }

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.moveH);
    window.removeEventListener('pointerup', this.upH);
    this.audioCtx?.close().catch(() => {});
  }

  /** Derive a friendly [min,max,step] range from the goal's suggestions. */
  private setupRange(): void {
    const sugg = (this.goal.suggested_amounts || []).filter((n) => n > 0);
    const lo = sugg.length ? Math.min(...sugg) : this.goal.default_amount * 0.25;
    const hi = sugg.length ? Math.max(...sugg) : this.goal.default_amount * 2;
    // Pad the range a little so the default sits comfortably inside it and the
    // user can go both below and above the suggested band.
    this.min = this.niceFloor(lo * 0.5);
    this.max = this.niceCeil(hi * 1.5);
    // ~200 steps across the dial keeps dragging smooth but snappy.
    this.step = this.niceStep((this.max - this.min) / 200);
    this.amount = this.clampSnap(this.goal.default_amount || (this.min + this.max) / 2);
    this.lastTickAmount = this.amount;
  }

  // ---------- knob math ----------

  /** Fraction 0..1 of the current amount within [min,max]. */
  get fraction(): number {
    const f = (this.amount - this.min) / (this.max - this.min || 1);
    return Math.max(0, Math.min(1, f));
  }

  /** Handle angle in degrees for the current amount. */
  get angle(): number {
    return this.START + this.fraction * this.SWEEP;
  }

  /** SVG arc dash length for the progress ring (circumference * sweep frac). */
  get dashArray(): string {
    const circumference = 2 * Math.PI * 42; // r = 42 in the 100x100 viewBox
    const arcFrac = this.SWEEP / 360;
    const filled = circumference * arcFrac * this.fraction;
    const rest = circumference - filled;
    return `${filled} ${rest}`;
  }

  /** Position (in the 100x100 viewBox) of the draggable handle. */
  get handle(): { x: number; y: number } {
    const rad = ((this.angle - 90) * Math.PI) / 180;
    return { x: 50 + 42 * Math.cos(rad), y: 50 + 42 * Math.sin(rad) };
  }

  // ---------- pointer handling ----------

  startDrag(e: PointerEvent): void {
    e.preventDefault();
    this.dragging = true;
    this.ensureAudio();
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

  /** Convert a pointer position on the dial into an amount. */
  private applyPointer(e: PointerEvent): void {
    const el = this.dialRef?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    // Angle measured from 12 o'clock, clockwise, in degrees.
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg > 180) deg -= 360;

    // Map into the -135..+135 gauge; ignore the dead zone at the bottom.
    let frac: number;
    if (deg < this.START) frac = deg < -180 - this.START ? 1 : 0; // nearest edge
    else if (deg > this.START + this.SWEEP) frac = 1;
    else frac = (deg - this.START) / this.SWEEP;
    frac = Math.max(0, Math.min(1, frac));

    const raw = this.min + frac * (this.max - this.min);
    this.setAmount(raw);
  }

  // ---------- amount setters + feedback ----------

  setAmount(raw: number): void {
    const snapped = this.clampSnap(raw);
    if (snapped !== this.amount) {
      this.amount = snapped;
      this.tickFeedback();
    }
  }

  nudge(dir: number): void {
    this.ensureAudio();
    this.setAmount(this.amount + dir * this.step);
  }

  pickSuggested(v: number): void {
    this.ensureAudio();
    this.setAmount(v);
  }

  private clampSnap(v: number): number {
    const snapped = Math.round(v / this.step) * this.step;
    return Math.max(this.min, Math.min(this.max, snapped));
  }

  /** Haptic + audio + a "beat" the template can animate against. */
  private tickFeedback(): void {
    const delta = Math.abs(this.amount - this.lastTickAmount);
    // Only fire discrete feedback every few steps so fast drags don't machine-gun.
    if (delta >= this.step * 0.99) {
      this.lastTickAmount = this.amount;
      if (!this.muted) this.playTick();
      if (navigator.vibrate && !this.reduceMotion) navigator.vibrate(6);
    }
  }

  private ensureAudio(): void {
    if (this.muted) return;
    if (!this.audioCtx) {
      const Ctx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) this.audioCtx = new Ctx();
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
  }

  private playTick(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Pitch rises slightly with the value for a satisfying "climbing" feel.
    osc.frequency.value = 320 + this.fraction * 520;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    localStorage.setItem('wp_knob_muted', this.muted ? '1' : '0');
    if (!this.muted) this.ensureAudio();
  }

  // ---------- numeric dialer ----------

  openDialer(): void {
    this.dialerValue = String(Math.round(this.amount));
    this.dialerOpen = true;
  }

  closeDialer(commit: boolean): void {
    if (commit) {
      const v = parseInt(this.dialerValue || '0', 10);
      if (v > 0) this.setAmount(v);
    }
    this.dialerOpen = false;
  }

  pressKey(k: string): void {
    this.ensureAudio();
    if (!this.muted) this.playTick();
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

  /** Big compact label, e.g. ₹2 Cr, ₹50 L. */
  get compact(): string {
    return this.compactInr(this.amount);
  }

  /** Full grouped figure under the compact label, e.g. ₹2,00,00,000. */
  get full(): string {
    return '₹' + Math.round(this.amount).toLocaleString('en-IN');
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

  confirm(): void {
    if (!this.muted) {
      this.ensureAudio();
      // A brighter confirmation chirp.
      const ctx = this.audioCtx;
      if (ctx) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.19);
      }
    }
    if (navigator.vibrate && !this.reduceMotion) navigator.vibrate([10, 30, 10]);
    this.amountChosen.emit(Math.round(this.amount));
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
