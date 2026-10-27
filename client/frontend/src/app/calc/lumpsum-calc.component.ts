import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, HostListener, Output, computed, effect, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { fmtInr, simulatePayout, windowBetween, windowFor, ymLabel } from './engine';
import { inr, rate, terms } from './view/common';
import { lumpsumView } from './view/lumpsum.view';
import { CalcDataService } from './calc-data.service';
import { yearsAvailable } from './fd-vs-dv.component';
import { VillaPickComponent } from './villa-pick.component';
import { YearCol, YearColsComponent } from './year-cols.component';

const AMOUNTS = [25_00_000, 50_00_000, 1_00_00_000, 2_50_00_000, 5_00_00_000];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** the shortest window the dates allow, in months */
const MIN_SPAN = 12;
/** 'YYYY-MM' → a month count, so months compare and subtract */
const mi = (ym: string) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;

/**
 * Lumpsum into DigiVilla — "had you put this amount into today's mix N years ago,
 * taking a monthly income": real units at the start month's NAV, ₹30,000 a month
 * per ₹1 Cr paid out of the arbitrage fund (backtest.model.ts → simulatePayout,
 * the same engine as FD vs DigiVilla). One 3D column per year — tap to read it.
 * Assumptions behind "How this is worked out".
 */
@Component({
  selector: 'app-lumpsum-calc',
  standalone: true,
  imports: [CommonModule, AmountDialComponent, YearColsComponent, VillaPickComponent],
  templateUrl: './lumpsum-calc.component.html',
  styleUrls: ['./calc-screen.scss', './sip-calc.component.scss'],
})
export class LumpsumCalcComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly AMOUNTS = AMOUNTS;
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = inr;
  readonly rate = rate;
  /** the settings, in the words screens quote */
  readonly t = computed(() => terms(this.store.config(), this.store.villa().key));

  readonly amount = signal(1_00_00_000);
  readonly years = signal(15);
  readonly picker = signal<'amt' | 'yrs' | null>(null);
  readonly page = signal<'calc' | 'notes'>('calc');
  readonly swp = this.store.swp;
  readonly villa = this.store.villa;

  readonly failed = this.store.failed;
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));
  /** "Sep 2011"-style labels for the date chip, one per year option */
  readonly startOpts = computed(() => {
    const d = this.store.data();
    return this.yearOpts().map((y) => ({ y, label: d ? ymLabel(windowFor(d, y).months[0]) : `${y} years ago` }));
  });
  /** any two months the client picks ('YYYY-MM'); null = the year presets */
  readonly custom = signal<{ from: string; to: string } | null>(null);
  readonly firstMonth = computed(() => this.store.data()?.months[0] ?? '');
  readonly lastMonth = computed(() => { const m = this.store.data()?.months; return m ? m[m.length - 1] : ''; });
  readonly win = computed(() => {
    const d = this.store.villaData(); if (!d) return null;
    const c = this.custom();
    return c && c.from && c.to ? windowBetween(d, c.from, c.to) : windowFor(d, this.years());
  });
  /** the window's last month; "today" when it is the latest month there is */
  readonly endMonth = computed(() => { const w = this.win(); return w ? w.months[w.months.length - 1] : ''; });
  readonly endsToday = computed(() => this.endMonth() === this.lastMonth());
  readonly endWord = computed(() => (this.endsToday() ? 'today' : 'in ' + ymLabel(this.endMonth())));
  /** "2 yrs 4 mos" — the length of the window actually used */
  readonly spanLabel = computed(() => {
    const n = Math.max(0, (this.win()?.months.length ?? 1) - 1), y = Math.floor(n / 12), m = n % 12;
    return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || '0 mos';
  });

  // ── the month picker in the years row ──
  readonly mp = signal<{ which: 'from' | 'to'; year: number } | null>(null);
  readonly minYear = computed(() => +this.firstMonth().slice(0, 4));
  readonly maxYear = computed(() => +this.lastMonth().slice(0, 4));
  readonly monthCells = computed(() => {
    const m = this.mp(), c = this.custom(); if (!m || !c) return [];
    const first = mi(this.firstMonth()), last = mi(this.lastMonth());
    // a window is at least a year: from ≤ to − 12, to ≥ from + 12
    const lo = m.which === 'from' ? first : mi(c.from) + MIN_SPAN;
    const hi = m.which === 'from' ? mi(c.to) - MIN_SPAN : last;
    const cur = m.which === 'from' ? c.from : c.to;
    return MONTHS.map((label, k) => {
      const ym = `${m.year}-${String(k + 1).padStart(2, '0')}`, i = mi(ym);
      return { ym, label, ok: i >= lo && i <= hi, on: ym === cur };
    });
  });
  readonly r = computed(() => {
    const w = this.win();
    return w ? simulatePayout(w, { amount: this.amount(), fdRate: 0, slabPct: this.t().defaultSlab, swp: this.swp() }, this.store.config()) : null;
  });
  readonly view = computed(() => { const r = this.r(); return r ? lumpsumView(r, this.amount()) : null; });

  readonly yearCols = computed<YearCol[]>(() => this.view()?.yearCols ?? []);
  readonly explain = computed(() => this.view()?.explain ?? null);
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() {
    this.store.load();
    // the villa picker shows this screen's figure, so the two can't disagree
    effect(() => { const r = this.r(); this.store.shown.set(r ? { rate: r.dvIrr ?? null, years: this.custom() ? Math.round(r.years * 10) / 10 : this.years() } : null); }, { allowSignalWrites: true });
    inject(DestroyRef).onDestroy(() => this.store.shown.set(null));
  }
  retry(): void { this.store.load(); }
  togglePicker(p: 'amt' | 'yrs'): void { this.picker.set(this.picker() === p ? null : p); }
  pickAmount(v: number): void { this.amount.set(v); this.picker.set(null); }
  pickYears(y: number): void { this.custom.set(null); this.years.set(y); this.picker.set(null); }
  /** dates: start from the window on screen, then ask for the start month */
  useCustom(): void {
    const w = this.win(); if (!w) return;
    this.custom.set({ from: w.months[0], to: w.months[w.months.length - 1] });
    this.openMonths('from');
  }
  clearCustom(): void { this.mp.set(null); this.custom.set(null); }
  openMonths(which: 'from' | 'to'): void {
    const c = this.custom(); if (!c) return;
    this.mp.set(this.mp()?.which === which ? null : { which, year: +(which === 'from' ? c.from : c.to).slice(0, 4) });
  }
  stepYear(d: number): void { const m = this.mp(); if (m) this.mp.set({ ...m, year: Math.min(this.maxYear(), Math.max(this.minYear(), m.year + d)) }); }
  pickMonth(ym: string): void {
    const m = this.mp(), c = this.custom(); if (!m || !c) return;
    this.custom.set({ ...c, [m.which]: ym });
    this.mp.set(null);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  go(p: 'calc' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }
  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.mp()) this.mp.set(null);
    else if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
