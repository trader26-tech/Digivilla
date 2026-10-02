import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, HostListener, Output, computed, effect, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { fmtInr, simulateFlat, windowFor, worstYearPct, ymLabel } from './engine';
import { Bars3dComponent, Col3d } from './bars-3d.component';
import { CalcDataService } from './calc-data.service';
import { inr, rate, terms } from './view/common';
import { flatView } from './view/flat.view';


type Key = 'price' | 'value' | 'bought' | 'rent';
interface Field { key: Key; label: string; min: number; max: number; step: number; big: number; major: number; mid: number; f: (n: number) => string; }

/**
 * Flat vs DigiVilla — "had the same money gone into DigiVilla when you bought
 * the flat". Four question cards (bought it for · worth today · bought in · rent
 * a month) share one ruler: tap a card, slide to change it. The flat side uses
 * your numbers; the DigiVilla side is today's mix at real NAVs from the purchase
 * month, paying 3.6% a year as monthly rent out of its arbitrage fund.
 * Maths in backtest.model.ts → simulateFlat.
 */
@Component({
  selector: 'app-flat-calc',
  standalone: true,
  imports: [CommonModule, Bars3dComponent, AmountDialComponent],
  templateUrl: './flat-calc.component.html',
  styleUrls: ['./calc-screen.scss', './flat-calc.component.scss'],
})
export class FlatCalcComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = inr;
  readonly rate = rate;
  /** the settings, in the words screens quote; F = the flat's assumptions */
  readonly t = computed(() => terms(this.store.config()));
  readonly F = computed(() => this.store.config().flat);

  // ── answers ──
  readonly price = signal(60_00_000);
  readonly value = signal(90_00_000);
  readonly rent = signal(20_000);
  readonly bought = signal<number | null>(null);         // set once the data says which years exist
  readonly active = signal<Key>('price');
  readonly page = signal<'calc' | 'vs' | 'notes'>('calc');
  readonly swp = this.store.swp;
  readonly villa = this.store.villa;

  readonly failed = this.store.failed;
  /** the last month with prices, and the years real history covers */
  readonly endYm = computed(() => this.store.data()?.months.at(-1) ?? null);
  readonly endYear = computed(() => Number((this.endYm() ?? `${new Date().getFullYear()}`).slice(0, 4)));
  readonly yearRange = computed(() => {
    const d = this.store.data();
    const maxYears = d ? Math.floor((d.months.length - 1) / 12) : 15;
    return { min: this.endYear() - maxYears, max: this.endYear() - 1 };
  });
  readonly boughtYear = computed(() => {
    const b = this.bought() ?? this.endYear() - 8;
    const { min, max } = this.yearRange();
    return Math.min(max, Math.max(min, b));
  });
  readonly held = computed(() => this.endYear() - this.boughtYear());

  readonly win = computed(() => { const d = this.store.villaData(); return d ? windowFor(d, this.held()) : null; });
  readonly r = computed(() => {
    const w = this.win();
    if (!w || !(this.price() > 0) || !(this.value() > 0)) return null;
    return simulateFlat(w, { price: this.price(), value: this.value(), rent: this.rent(), slabPct: this.t().defaultSlab, swp: this.swp() },
                        this.store.config());
  });
  readonly dvWins = computed(() => { const r = this.r(); return !!r && r.dvTotal > r.flTotal; });

  readonly worstEver = computed(() => { const d = this.store.villaData(); return d ? worstYearPct(windowFor(d, 100)) : null; });
  readonly view = computed(() => {
    const r = this.r();
    return r ? flatView({ r, cfg: this.store.config(), t: this.t(), value: this.value(), rent: this.rent(), worst: this.worstEver(),
                          historyYear: (this.store.data()?.months[0] ?? '').slice(0, 4) }) : null;
  });
  readonly flCol = computed<Col3d | null>(() => this.view()?.flCol ?? null);
  readonly dvCol = computed<Col3d | null>(() => this.view()?.dvCol ?? null);

  // ── the four questions, one shared ruler ──
  readonly fields = computed<Field[]>(() => {
    const yr = this.yearRange();
    return [
      { key: 'price', label: 'Bought it for', min: 20_00_000, max: 5_00_00_000, step: 2_50_000, big: 10_00_000, major: 1_00_00_000, mid: 25_00_000, f: fmtInr },
      { key: 'value', label: 'Worth today', min: 20_00_000, max: 10_00_00_000, step: 2_50_000, big: 10_00_000, major: 1_00_00_000, mid: 25_00_000, f: fmtInr },
      { key: 'bought', label: 'Bought in', min: yr.min, max: yr.max, step: 1, big: 1, major: 10, mid: 5, f: (n) => String(n) },
      { key: 'rent', label: 'Rent a month', min: 0, max: 3_00_000, step: 1000, big: 5000, major: 50_000, mid: 10_000, f: (n) => '₹' + n.toLocaleString('en-IN') },
    ];
  });
  readonly act = computed(() => this.fields().find((f) => f.key === this.active())!);
  val(k: Key): number {
    return k === 'price' ? this.price() : k === 'value' ? this.value() : k === 'rent' ? this.rent() : this.boughtYear();
  }
  setVal(n: number): void {
    const k = this.active();
    if (k === 'price') this.price.set(n);
    else if (k === 'value') this.value.set(n);
    else if (k === 'rent') this.rent.set(n);
    else this.bought.set(n);
  }

  // ── side by side + the walk-through ──
  readonly vs = computed(() => this.view()?.vs ?? []);
  readonly explain = computed(() => this.view()?.explain ?? null);
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() {
    this.store.load();
    // the villa picker shows this screen's figure, so the two can't disagree
    effect(() => { const r = this.r(); this.store.shown.set(r ? { rate: r.dv.dvIrr ?? null, years: this.held() } : null); }, { allowSignalWrites: true });
    inject(DestroyRef).onDestroy(() => this.store.shown.set(null));
  }
  retry(): void { this.store.load(); }
  go(p: 'calc' | 'vs' | 'notes'): void { this.page.set(p); window.scrollTo({ top: 0 }); }
  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.page() !== 'calc') this.go('calc'); }
}
