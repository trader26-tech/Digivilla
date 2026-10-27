import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, HostListener, Output, computed, effect, inject, signal, untracked } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { fmtInr, simulatePayout, swpMonthly, windowFor, worstYearPct, ymLabel } from './engine';
import { Bars3dComponent, Col3d } from './bars-3d.component';
import { CalcDataService } from './calc-data.service';
import { inr, pct, rate, terms } from './view/common';
import { fdView } from './view/fd.view';

export const FD_RATES = [5.5, 6, 6.5, 7, 7.5, 8];
export const TAX_SLABS = [0, 5, 10, 15, 20, 25, 30];
export const YEAR_OPTS = [5, 8, 10, 15, 20];
/** Only the year tabs real fund history fully covers (it starts Jul 2007, so 20 years is out). */
export function yearsAvailable(months: number | null): number[] {
  return months === null ? YEAR_OPTS.slice(0, -1) : YEAR_OPTS.filter((y) => 12 * y <= months - 1);
}

/**
 * FD vs DigiVilla — "had you put this amount in N years ago": a bank FD at your
 * rate, or TODAY'S DigiVilla mix at the real month-end NAVs since then, paying
 * ₹30,000 a month per ₹1 Cr out of its arbitrage fund (so the arbitrage share
 * shrinks). Two 3D columns: FD (paid out + principal) vs DigiVilla (paid out +
 * arbitrage left + growth funds). "Side by side" compares the parts that matter;
 * the assumptions sit behind a quiet link in the fine print.
 * Maths in backtest.model.ts.
 */
@Component({
  selector: 'app-fd-vs-dv',
  standalone: true,
  imports: [CommonModule, Bars3dComponent, AmountDialComponent],
  templateUrl: './fd-vs-dv.component.html',
  styleUrls: ['./calc-screen.scss', './fd-vs-dv.component.scss'],
})
export class FdVsDvComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly FD_RATES = FD_RATES;
  readonly TAX_SLABS = TAX_SLABS;
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = inr;
  readonly pct = pct;
  readonly rate = rate;
  /** the settings, in the words screens quote ("3.6%", "₹1,25,000"…) */
  readonly t = computed(() => terms(this.store.config(), this.store.villa().key));

  // ── answers ──
  readonly amount = signal(1_00_00_000);
  readonly years = signal(8);                          // the website's default too
  readonly fdRate = signal(6.5);
  readonly slab = signal<number | null>(null);          // null = the settings' default slab
  readonly nri = signal(false);
  readonly tax = computed(() => (this.nri() ? this.t().nriTdsPct : this.slab() ?? this.t().defaultSlab));

  // ── ui ──
  readonly picker = signal<'rate' | 'tax' | null>(null);
  readonly page = signal<'calc' | 'vs' | 'notes'>('calc');
  readonly swp = this.store.swp;
  readonly villa = this.store.villa;
  /** "FD that compounds": a cumulative FD (interest added every quarter, taxed each year) against a
   *  villa that reinvests everything — so the SWP is off while it's on; SWP back on = payout FD again */
  readonly compound = signal(false);
  private swpBefore: boolean | null = null;
  /** a one-line note on what the switch just changed (in the fine print) */
  readonly note = signal<string | null>(null);
  private noteT?: ReturnType<typeof setTimeout>;
  /** the (i) beside the villa in the legend: the long-run rate lives there */
  readonly rateNote = signal(false);

  // ── data → result → what the screen shows ──
  readonly failed = this.store.failed;
  readonly win = computed(() => { const d = this.store.villaData(); return d ? windowFor(d, this.years()) : null; });
  readonly r = computed(() => {
    const w = this.win();
    const cmp = this.compound();
    return w ? simulatePayout(w, { amount: this.amount(), fdRate: this.fdRate(), slabPct: this.tax(), swp: this.swp() && !cmp, fdMode: cmp ? 'cumulative' : 'payout' }, this.store.config()) : null;
  });
  /** Risk is a property of the villa, so it's measured over all the history there is. */
  readonly worstEver = computed(() => { const d = this.store.villaData(); return d ? worstYearPct(windowFor(d, 100)) : null; });
  readonly historyYear = computed(() => (this.store.data()?.months[0] ?? '').slice(0, 4));
  readonly payout = computed(() => this.amount() * swpMonthly(this.store.config(), this.store.villa().key));
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));
  readonly view = computed(() => {
    const r = this.r();
    return r ? fdView({ r, cfg: this.store.config(), villa: this.villa(), amount: this.amount(), fdRate: this.fdRate(),
                        worst: this.worstEver(), historyYear: this.historyYear() }) : null;
  });
  readonly fdCol = computed<Col3d | null>(() => this.view()?.fdCol ?? null);
  readonly dvCol = computed<Col3d | null>(() => this.view()?.dvCol ?? null);
  readonly vs = computed(() => this.view()?.vs ?? []);
  readonly explain = computed(() => this.view()?.explain ?? null);
  /** Series younger than the window: whose returns stood in, and until when. */
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() {
    this.store.load();
    // the villa picker shows this screen's figure, so the two can't disagree
    effect(() => { const r = this.r(); this.store.shown.set(r ? { rate: r.dvIrr ?? null, years: this.years() } : null); }, { allowSignalWrites: true });
    // SWP turned on (in the villa picker) while the FD compounds → back to a payout FD, and say so
    effect(() => {
      if (this.swp() && untracked(this.compound)) { this.compound.set(false); this.swpBefore = null; this.say('SWP on — so the FD pays its interest out monthly again.'); }
    }, { allowSignalWrites: true });
    inject(DestroyRef).onDestroy(() => {
      this.store.shown.set(null); clearTimeout(this.noteT);
      if (this.compound() && this.swpBefore !== null) this.store.setSwp(this.swpBefore);   // other calculators keep the SWP you had
    });
  }
  toggleCompound(): void {
    if (this.compound()) {
      this.compound.set(false);
      if (this.swpBefore !== null) this.store.setSwp(this.swpBefore);
      this.swpBefore = null;
      this.say('Payout FD: interest paid out monthly, principal back at the end.');
    } else {
      this.swpBefore = this.swp();
      this.compound.set(true);
      this.store.setSwp(false);
      this.say(null);
    }
  }
  private say(t: string | null): void { clearTimeout(this.noteT); this.note.set(t); if (t) this.noteT = setTimeout(() => this.note.set(null), 6000); }
  closeNote(): void { this.rateNote.set(false); }
  toggleNote(): void { this.rateNote.set(!this.rateNote()); }
  /** the villa's long-run rate (the settings' window, nothing withdrawn) — only in the (i) note */
  readonly longRun = computed(() => this.store.rates()?.[this.villa().key] ?? null);
  readonly rateYears = computed(() => this.store.config().display?.rate_years ?? 15);
  readonly span = computed(() => { const r = this.r(); return r ? `${ymLabel(r.months[0])} → ${ymLabel(r.months[r.months.length - 1])}` : ''; });
  retry(): void { this.store.load(); }

  togglePicker(p: 'rate' | 'tax'): void { this.picker.set(this.picker() === p ? null : p); }
  pickRate(r: number): void { this.fdRate.set(r); this.picker.set(null); }
  pickSlab(s: number): void { this.nri.set(false); this.slab.set(s); this.picker.set(null); }
  pickNri(): void { this.nri.set(true); this.picker.set(null); }
  go(p: 'calc' | 'vs' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }

  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.rateNote()) this.closeNote();
    else if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
