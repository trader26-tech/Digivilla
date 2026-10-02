import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, HostListener, Output, computed, effect, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { fmtInr, simulateSip, windowFor, ymLabel } from './engine';
import { inr, rate, terms } from './view/common';
import { sipView } from './view/sip.view';
import { CalcDataService } from './calc-data.service';
import { yearsAvailable } from './fd-vs-dv.component';
import { VillaPickComponent } from './villa-pick.component';
import { YearCol, YearColsComponent } from './year-cols.component';

/** quick picks — NRI clients often invest well above ₹1 L a month */
const AMOUNTS = [25_000, 50_000, 1_00_000, 2_00_000, 5_00_000];
const STEPS = [0, 5, 10, 15];

/**
 * SIP into DigiVilla — "had you started a monthly SIP in today's mix N years ago",
 * stepping up each year, with 3.6% of the value paid to you at every year end.
 * Real month-end NAVs (backtest.model.ts → simulateSipIncome).
 *
 * Hero: what it's worth today after tax (income not included), what you put in,
 * the income you got. Chart: one 3D column per year (app-year-cols) — tap one
 * to read it in the strip docked at the top. Assumptions behind "How this is
 * worked out".
 */
@Component({
  selector: 'app-sip-calc',
  standalone: true,
  imports: [CommonModule, AmountDialComponent, YearColsComponent, VillaPickComponent],
  templateUrl: './sip-calc.component.html',
  styleUrls: ['./calc-screen.scss', './sip-calc.component.scss'],
})
export class SipCalcComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly AMOUNTS = AMOUNTS;
  readonly STEPS = STEPS;
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = inr;
  readonly rate = rate;
  /** the settings, in the words screens quote */
  readonly t = computed(() => terms(this.store.config()));

  // ── answers ──
  readonly monthly = signal(25_000);
  readonly step = signal(10);
  readonly years = signal(15);
  readonly picker = signal<'amt' | 'step' | null>(null);
  readonly page = signal<'calc' | 'notes'>('calc');
  readonly swp = this.store.swp;
  readonly villa = this.store.villa;

  readonly failed = this.store.failed;
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));
  readonly win = computed(() => { const d = this.store.villaData(); return d ? windowFor(d, this.years()) : null; });
  readonly r = computed(() => {
    const w = this.win();
    return w ? simulateSip(w, { monthly: this.monthly(), stepPct: this.step(), slabPct: this.t().defaultSlab, swp: this.swp() }, this.store.config()) : null;
  });
  readonly view = computed(() => { const r = this.r(); return r ? sipView(r, this.monthly()) : null; });

  readonly yearCols = computed<YearCol[]>(() => this.view()?.yearCols ?? []);
  readonly explain = computed(() => this.view()?.explain ?? null);

  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() {
    this.store.load();
    // the villa picker shows this screen's figure, so the two can't disagree
    effect(() => { const r = this.r(); this.store.shown.set(r ? { rate: r.xirr ?? null, years: this.years() } : null); }, { allowSignalWrites: true });
    inject(DestroyRef).onDestroy(() => this.store.shown.set(null));
  }
  retry(): void { this.store.load(); }

  pickYears(y: number): void { this.years.set(y); }
  togglePicker(p: 'amt' | 'step'): void { this.picker.set(this.picker() === p ? null : p); }
  pickAmount(v: number): void { this.monthly.set(v); this.picker.set(null); }
  pickStep(v: number): void { this.step.set(v); this.picker.set(null); }
  go(p: 'calc' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
