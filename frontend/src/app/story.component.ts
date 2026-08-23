import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  EventEmitter,
  OnDestroy,
  Output,
} from '@angular/core';

/**
 * The cinematic value hero shown after the intro, before the goal picker.
 *
 * Matches the intro's dramatic, immersive energy: a dark dusk backdrop where a
 * green growth curve glows to life and a big personal number counts up — showing
 * that YOUR ₹10,000/month becomes far more with us than sitting idle.
 */
@Component({
  selector: 'app-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent implements AfterViewInit, OnDestroy {
  @Output() done = new EventEmitter<void>();

  // ₹10,000/month for 20 years.
  readonly investedFinal = 9_100_000; // grown & compounded with us
  readonly savedFinal = 2_400_000; // left idle (contributions only)

  invested = 0;
  saved = 0;
  /** staged reveal phases so it plays like a sequence, not all at once */
  phase = 0; // 0 hidden, 1 line drawing, 2 counting, 3 settled

  private raf = 0;
  private timers: number[] = [];

  ngAfterViewInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.invested = this.investedFinal;
      this.saved = this.savedFinal;
      this.phase = 3;
      return;
    }
    this.timers.push(
      window.setTimeout(() => (this.phase = 1), 150), // curve starts drawing
      window.setTimeout(() => {
        this.phase = 2;
        this.runCounters();
      }, 800), // number races up as the curve climbs
      window.setTimeout(() => (this.phase = 3), 2600), // settle + glow
    );
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
  }

  private runCounters(): void {
    const dur = 1800;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const k = ease(t);
      this.invested = Math.round(this.investedFinal * k);
      this.saved = Math.round(this.savedFinal * k);
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Full grouped rupees for the big hero number, e.g. 91,00,000. */
  grouped(v: number): string {
    return Math.round(v).toLocaleString('en-IN');
  }
  /** Compact for the small savings figure. */
  compact(v: number): string {
    if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)} Cr`;
    if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  get multiple(): string {
    return (this.investedFinal / this.savedFinal).toFixed(1);
  }

  start(): void {
    this.done.emit();
  }
}
