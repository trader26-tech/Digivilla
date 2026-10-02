import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnDestroy, ViewChild, computed, signal } from '@angular/core';

import { fmtInr } from './backtest.model';

/** One year's column. Heights are in ₹ (scaled here); `fields` fill the docked strip. */
export interface YearCol {
  tick: string;                                        // under the column: 'Y5' / '’16'
  badge: string;                                       // in the strip: 'Year 5' / '2016'
  put: number;                                         // dark — what you put in
  grew: number;                                        // light — growth on top
  cap: number;                                         // gold — that year's payout
  fields: { label: string; value: number; tone?: 'g' | 'gold'; suffix?: string }[];
}

/**
 * Year-by-year 3D columns (dark = put in, light = grew, gold cap = that year's
 * income) on a grid floor, with a strip docked at the top that reads out the
 * picked year (the last one until you tap another) and a dashed line down to
 * its column. Used by SIP and Lumpsum.
 */
@Component({
  selector: 'app-year-cols',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './year-cols.component.html',
  styleUrls: ['./year-cols.component.scss'],
})
export class YearColsComponent implements OnDestroy {
  @Input({ required: true }) set cols(c: YearCol[]) {
    if (c.length !== this.data().length) this.sel.set(null);   // a new period: back to "today"
    this.data.set(c);
  }
  readonly data = signal<YearCol[]>([]);
  /** until "Show me": faint outlines only — then the real columns grow up */
  @Input() set veiled(v: boolean) { this.veil.set(v); }
  readonly veil = signal(false);
  readonly sel = signal<number | null>(null);
  readonly fmt = fmtInr;

  private readonly W = signal(350);
  private readonly H = signal(330);
  private ro?: ResizeObserver;
  @ViewChild('chart') set chartEl(ref: ElementRef<HTMLElement> | undefined) {
    this.ro?.disconnect();
    const el = ref?.nativeElement;
    if (!el) return;
    const measure = () => {
      if (Math.abs(el.clientWidth - this.W()) > 1) this.W.set(el.clientWidth);
      if (Math.abs(el.clientHeight - this.H()) > 1) this.H.set(el.clientHeight);
    };
    measure();
    this.ro = new ResizeObserver(measure);
    this.ro.observe(el);
  }

  readonly view = computed(() => {
    const d = this.data();
    const Y = d.length;
    if (!Y) return null;
    const depth = Math.max(6, Math.min(14, Math.round(230 / Y)));
    const gap = Y > 12 ? 4 : 7;
    const maxH = Math.max(80, this.H() - 22 - depth - 66);
    const scale = maxH / Math.max(...d.map((c) => c.put + c.grew + c.cap), 1);
    const selI = this.sel() !== null && this.sel()! < Y ? this.sel()! : Y - 1;
    const tickEvery = Y > 12 ? 3 : Y > 8 ? 2 : 1;
    const cols = d.map((c, i) => {
      const cap = c.cap > 0 ? Math.max(3, Math.round(c.cap * scale)) : 0;
      const grew = Math.max(0, Math.round(c.grew * scale));
      const put = Math.max(4, Math.round(c.put * scale));
      const h = cap + grew + put;
      const a = i === Y - 1 ? 1 : 0.55 + 0.45 * (i / Y);
      const on = i === selI;
      return {
        i, h, cap, grew, on, tick: c.tick,
        showTick: i === 0 || i === Y - 1 || (i + 1) % tickEvery === 0,
        dim: this.sel() !== null && !on,
        capBg: on ? '#f6e3a6' : `rgba(224,184,74,${a})`,
        grewBg: on ? '#c9efad' : `rgba(154,212,113,${a})`,
        putBg: on ? '#4f9528' : `rgba(47,106,26,${a})`,
        top: on ? '#f6e3a6' : cap ? `rgba(240,214,140,${a})` : `rgba(211,240,189,${a})`,
        side: `linear-gradient(180deg, rgba(176,138,44,${a}) 0px ${cap}px, rgba(127,184,90,${a}) ${cap}px ${cap + grew}px, rgba(31,74,19,${a}) ${cap + grew}px ${h}px)`,
        delay: `${(0.15 + i * 0.06).toFixed(2)}s`,
      };
    });
    const colW = (this.W() - 18 - 34 - gap * (Y - 1)) / Y;
    return {
      cols, depth, gap,
      lineX: 18 + selI * (colW + gap) + colW / 2 + depth / 2,
      lineBottom: 22 + cols[selI].h + depth + 6,
      strip: d[selI],
    };
  });

  pick(i: number): void { this.sel.set(this.sel() === i ? null : i); }
  ngOnDestroy(): void { this.ro?.disconnect(); }
}
