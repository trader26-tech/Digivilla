import { Signal, computed, signal } from '@angular/core';

import { Window, ymLabel } from './engine';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** the shortest window the dates allow, in months */
const MIN_SPAN = 12;
/** 'YYYY-MM' → a month count, so months compare and subtract */
const mi = (ym: string) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;

/**
 * "dates" in a calculator's years row: any start and end month instead of N yrs ago.
 * `custom` null = the year presets. The month grid (`mp`) opens on From or To and only
 * offers months inside the history, at least a year apart. Used by Lumpsum and SIP.
 */
export class DateWindow {
  /** any two months the client picks ('YYYY-MM'); null = the year presets */
  readonly custom = signal<{ from: string; to: string } | null>(null);
  readonly mp = signal<{ which: 'from' | 'to'; year: number } | null>(null);

  readonly minYear = computed(() => +this.first().slice(0, 4));
  readonly maxYear = computed(() => +this.last().slice(0, 4));

  /** first / last month of the history; the window on screen */
  constructor(private first: Signal<string>, private last: Signal<string>, private win: Signal<Window | null>) {}

  /** the window's last month; "today" when it is the latest month there is */
  readonly endMonth = computed(() => { const w = this.win(); return w ? w.months[w.months.length - 1] : ''; });
  readonly endsToday = computed(() => this.endMonth() === this.last());
  readonly endWord = computed(() => (this.endsToday() ? 'today' : 'in ' + ymLabel(this.endMonth())));
  /** "2 yrs 4 mos" — the length of the window actually used */
  readonly spanLabel = computed(() => {
    const n = Math.max(0, (this.win()?.months.length ?? 1) - 1), y = Math.floor(n / 12), m = n % 12;
    return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || '0 mos';
  });

  readonly monthCells = computed(() => {
    const m = this.mp(), c = this.custom(); if (!m || !c) return [];
    const first = mi(this.first()), last = mi(this.last());
    // a window is at least a year: from ≤ to − 12, to ≥ from + 12
    const lo = m.which === 'from' ? first : mi(c.from) + MIN_SPAN;
    const hi = m.which === 'from' ? mi(c.to) - MIN_SPAN : last;
    const cur = m.which === 'from' ? c.from : c.to;
    return MONTHS.map((label, k) => {
      const ym = `${m.year}-${String(k + 1).padStart(2, '0')}`, i = mi(ym);
      return { ym, label, ok: i >= lo && i <= hi, on: ym === cur };
    });
  });

  /** dates: start from the window on screen, then ask for the start month */
  use(): void {
    const w = this.win(); if (!w) return;
    this.custom.set({ from: w.months[0], to: w.months[w.months.length - 1] });
    this.open('from');
  }
  clear(): void { this.mp.set(null); this.custom.set(null); }
  open(which: 'from' | 'to'): void {
    const c = this.custom(); if (!c) return;
    this.mp.set(this.mp()?.which === which ? null : { which, year: +(which === 'from' ? c.from : c.to).slice(0, 4) });
  }
  stepYear(d: number): void { const m = this.mp(); if (m) this.mp.set({ ...m, year: Math.min(this.maxYear(), Math.max(this.minYear(), m.year + d)) }); }
  pick(ym: string): void {
    const m = this.mp(), c = this.custom(); if (!m || !c) return;
    this.custom.set({ ...c, [m.which]: ym });
    this.mp.set(null);
    if (navigator.vibrate) navigator.vibrate(4);
  }
}
