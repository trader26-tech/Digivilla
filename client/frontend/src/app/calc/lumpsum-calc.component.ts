import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, HostListener, Output, computed, effect, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { fmtInr, simulatePayout, windowFor, ymLabel } from './engine';
import { inr, rate, terms } from './view/common';
import { lumpsumView } from './view/lumpsum.view';
import { CalcDataService } from './calc-data.service';
import { yearsAvailable } from './fd-vs-dv.component';
import { VillaPickComponent } from './villa-pick.component';
import { YearCol, YearColsComponent } from './year-cols.component';

const AMOUNTS = [25_00_000, 50_00_000, 1_00_00_000, 2_50_00_000, 5_00_00_000];

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
  readonly t = computed(() => terms(this.store.config()));

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
  readonly win = computed(() => { const d = this.store.villaData(); return d ? windowFor(d, this.years()) : null; });
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
    effect(() => { const r = this.r(); this.store.shown.set(r ? { rate: r.dvIrr ?? null, years: this.years() } : null); }, { allowSignalWrites: true });
    inject(DestroyRef).onDestroy(() => this.store.shown.set(null));
  }
  retry(): void { this.store.load(); }
  togglePicker(p: 'amt' | 'yrs'): void { this.picker.set(this.picker() === p ? null : p); }
  pickAmount(v: number): void { this.amount.set(v); this.picker.set(null); }
  pickYears(y: number): void { this.years.set(y); this.picker.set(null); }
  go(p: 'calc' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }
  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
