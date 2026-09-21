import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';

import { inr } from './format.util';

/**
 * COUNT-UP — a ₹ figure that visibly renders itself.
 *
 *   <span [appCountUp]="est.estateValue"></span>
 *
 * On first paint the number rolls from 0 to its value (~0.9 s, ease-out); on
 * every later change it rolls from the old value to the new one, so a refresh
 * or a NAV update is SEEN happening rather than silently swapped. Formatting is
 * the app's canonical inr() (₹12,50,000) and honours reduced-motion (instant).
 */
@Directive({ selector: '[appCountUp]', standalone: true })
export class CountUpDirective implements OnChanges, OnDestroy {
  @Input('appCountUp') value: number | null | undefined = 0;
  /** ms for the roll; the first paint uses a touch longer for presence. */
  @Input() countDuration = 900;
  /** Optional formatter (defaults to inr). */
  @Input() countFormat: (n: number) => string = inr;

  private el = inject(ElementRef<HTMLElement>);
  private shown = 0;
  private raf = 0;
  private first = true;
  private reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  ngOnChanges(_: SimpleChanges): void {
    const to = Number(this.value ?? 0) || 0;
    const from = this.first ? 0 : this.shown;
    const dur = this.first ? this.countDuration + 300 : this.countDuration;
    this.first = false;
    if (this.reduce || Math.abs(to - from) < 0.5) { this.paint(to); return; }
    cancelAnimationFrame(this.raf);
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);           // ease-out cubic
      this.paint(from + (to - from) * e);
      if (p < 1) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  ngOnDestroy(): void { cancelAnimationFrame(this.raf); }

  private paint(n: number): void {
    this.shown = n;
    this.el.nativeElement.textContent = this.countFormat(n);
  }
}
