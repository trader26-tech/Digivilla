import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  EventEmitter,
  OnDestroy,
  Output,
} from '@angular/core';

/**
 * The value-first welcome hero shown after the intro, before the goal picker.
 *
 * It doesn't just say "invest" — it SHOWS the gap: money left idle in savings
 * stays flat, while money invested with us soars. Two live counters race up so
 * the difference (our value) is felt, not read. One CTA into "Choose a goal".
 */
@Component({
  selector: 'app-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent implements AfterViewInit, OnDestroy {
  /** Emitted when the user taps the CTA -> show the goal picker. */
  @Output() done = new EventEmitter<void>();

  // Illustrative figures: ₹10k/month for 20 years.
  readonly savedFinal = 2_400_000; // money just parked (contributions only)
  readonly investedFinal = 9_100_000; // same, invested & compounded with us

  saved = 0;
  invested = 0;
  revealed = false; // triggers the chart draw-in

  private raf = 0;
  private timers: number[] = [];

  ngAfterViewInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.saved = this.savedFinal;
      this.invested = this.investedFinal;
      this.revealed = true;
      return;
    }
    // let the chart lines draw first, then race the counters up
    this.timers.push(window.setTimeout(() => (this.revealed = true), 100));
    this.timers.push(window.setTimeout(() => this.runCounters(), 650));
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
  }

  private runCounters(): void {
    const dur = 1600;
    const startTs = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / dur);
      const k = ease(t);
      this.saved = Math.round(this.savedFinal * k);
      this.invested = Math.round(this.investedFinal * k);
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Compact INR for the counters, e.g. ₹91.0 L, ₹24.0 L. */
  inr(v: number): string {
    if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)} Cr`;
    if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  /** How many times bigger invested is vs saved — the punchline. */
  get multiple(): string {
    return (this.investedFinal / this.savedFinal).toFixed(1);
  }

  start(): void {
    this.done.emit();
  }
}
