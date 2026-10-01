import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Output, computed, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { CESS, EQ_EXEMPT, PAYOUT_RATE, fmtInr, simulatePayout, windowFor, ymLabel } from './backtest.model';
import { CalcDataService } from './calc-data.service';
import { yearsAvailable } from './fd-vs-dv.component';
import { bySleeve } from './sleeves';
import { YearCol, YearColsComponent } from './year-cols.component';

const AMOUNTS = [25_00_000, 50_00_000, 1_00_00_000, 2_50_00_000, 5_00_00_000];
const SLAB = 30;              // short-term gains on the gold fund, if any are sold

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
  imports: [CommonModule, AmountDialComponent, YearColsComponent],
  templateUrl: './lumpsum-calc.component.html',
  styleUrls: ['./calc-screen.scss', './sip-calc.component.scss'],
})
export class LumpsumCalcComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly AMOUNTS = AMOUNTS;
  readonly EXEMPT = EQ_EXEMPT;
  readonly PAY_PCT = Math.round(PAYOUT_RATE * 12 * 1000) / 10;      // 3.6
  readonly cessPct = Math.round((CESS - 1) * 100);
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

  readonly amount = signal(1_00_00_000);
  readonly years = signal(15);
  readonly picker = signal<'amt' | 'yrs' | null>(null);
  readonly page = signal<'calc' | 'notes'>('calc');

  readonly failed = this.store.failed;
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));
  /** "Sep 2011"-style labels for the date chip, one per year option */
  readonly startOpts = computed(() => {
    const d = this.store.data();
    return this.yearOpts().map((y) => ({ y, label: d ? ymLabel(windowFor(d, y).months[0]) : `${y} years ago` }));
  });
  readonly win = computed(() => { const d = this.store.data(); return d ? windowFor(d, this.years()) : null; });
  readonly r = computed(() => { const w = this.win(); return w ? simulatePayout(w, this.amount(), 0, SLAB) : null; });

  /** One column per year: put in · grew · that year's income (gold). */
  readonly yearCols = computed<YearCol[]>(() => {
    const r = this.r();
    if (!r) return [];
    const a = this.amount();
    return r.yearly.map((y) => ({
      tick: '’' + y.month.slice(2, 4), badge: ymLabel(y.month),
      put: Math.min(a, y.value), grew: Math.max(0, y.value - a), cap: y.payout,
      fields: [
        { label: 'Worth', value: y.valueAfterTax, tone: 'g' as const },
        { label: 'Income so far', value: y.income, tone: 'gold' as const },
        { label: 'Worth + income', value: y.valueAfterTax + y.income },
      ],
    }));
  });

  readonly explain = computed(() => {
    const r = this.r();
    if (!r) return null;
    return {
      mix: bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow }))),
      payments: r.months.length - 1,
      taxTiny: r.dvPayoutTax < r.dvPaidGross * 0.01,
    };
  });
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() { this.store.load(); }
  retry(): void { this.store.load(); }
  togglePicker(p: 'amt' | 'yrs'): void { this.picker.set(this.picker() === p ? null : p); }
  pickAmount(v: number): void { this.amount.set(v); this.picker.set(null); }
  pickYears(y: number): void { this.years.set(y); this.picker.set(null); }
  go(p: 'calc' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }
  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  rate(v: number | null): string { return v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`; }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
