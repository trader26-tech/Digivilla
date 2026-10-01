import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Output, computed, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import {
  CESS, FLAT_REG_PCT, INCOME_RATE, INFLATION, RENT_RISE, STD_DEDUCTION, UPKEEP, VACANT_MONTHS,
  fmtInr, simulateFlat, windowFor, worstYearPct, ymLabel,
} from './backtest.model';
import { Bars3dComponent, Col3d } from './bars-3d.component';
import { CalcDataService } from './calc-data.service';
import { bySleeve } from './sleeves';

const STAMP_PCT = 7;          // stamp duty on the flat
const SLAB = 30;              // rent and the DigiVilla payout's small gold gains

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
  readonly inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  readonly STAMP = STAMP_PCT;
  readonly REG = FLAT_REG_PCT;
  readonly SLAB = SLAB;
  readonly RENT_RISE = RENT_RISE;
  readonly VACANT = VACANT_MONTHS;
  readonly UPKEEP_PCT = UPKEEP * 100;
  readonly STD_DED = STD_DEDUCTION * 100;
  readonly INCOME_PCT = Math.round(INCOME_RATE * 1000) / 10;   // 3.6, not 3.5999…
  readonly INFLATION = INFLATION;
  readonly cessPct = Math.round((CESS - 1) * 100);

  // ── answers ──
  readonly price = signal(60_00_000);
  readonly value = signal(90_00_000);
  readonly rent = signal(20_000);
  readonly bought = signal<number | null>(null);         // set once the data says which years exist
  readonly active = signal<Key>('price');
  readonly page = signal<'calc' | 'vs' | 'notes'>('calc');

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

  readonly win = computed(() => { const d = this.store.data(); return d ? windowFor(d, this.held()) : null; });
  readonly r = computed(() => {
    const w = this.win();
    if (!w || !(this.price() > 0) || !(this.value() > 0)) return null;
    return simulateFlat(w, { price: this.price(), value: this.value(), rent: this.rent(), stampPct: STAMP_PCT, slabPct: SLAB });
  });
  readonly dvWins = computed(() => { const r = this.r(); return !!r && r.dvTotal > r.flTotal; });

  readonly flCol = computed<Col3d | null>(() => {
    const r = this.r();
    if (!r) return null;
    return { art: 'flat-building', segs: [
      { label: 'Rent kept', val: r.rentKept, bg: 'linear-gradient(180deg,#6d7184,#585c6e)', side: '#454858', top: '#8b8fa3', k: '#d9dbe6', c: '#f2f2f6' },
      { label: 'Worth today', val: this.value(), bg: 'linear-gradient(180deg,#3a3d4a,#2b2e3a)', side: '#20222d', top: '#4a4e5c', k: '#b2b6ca', c: '#e4e7f5' },
    ] };
  });
  readonly dvCol = computed<Col3d | null>(() => {
    const r = this.r();
    if (!r) return null;
    return { art: 'villa', coin: true, green: true, segs: [
      { label: 'Rent paid', val: r.dv.dvPaid, bg: 'linear-gradient(180deg,#b9e69a,#9ad471)', side: '#7fb85a', top: '#d3f0bd', k: '#2b4d18', c: '#10240a' },
      { label: 'Value', val: r.dv.dvValue, bg: 'linear-gradient(180deg,#4f9528,#2a5e18)', side: '#1f4a13', top: '#6cba36', k: '#d8f2c4', c: '#f2fbe9' },
    ] };
  });

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

  // ── side by side ──
  readonly worstEver = computed(() => { const d = this.store.data(); return d ? worstYearPct(windowFor(d, 100)) : null; });
  readonly vs = computed(() => {
    const r = this.r();
    if (!r) return [];
    const G = '#8fd65a', N = '#e4e7f5', A = '#c9c6da', R = '#e0796b', Y = '#e9c15c';
    const flWins = r.flTotal > r.dvTotal;
    const worst = this.worstEver();
    const row = (k: string, icon: string, a: string, as: string, ac: string, b: string, bs: string, bc: string, win: 'fl' | 'dv', extra: object = {}) =>
      ({ k, icon, a, as, ac, b, bs, bc, win, gauge: false, aDeg: 0, bDeg: 0, ...extra });
    return [
      row('Real value', 'M3 12h4l3-8 4 16 3-8h4', fmtInr(r.flReal), 'in today’s money', flWins ? A : N, fmtInr(r.dvReal), 'in today’s money', G, flWins ? 'fl' : 'dv'),
      row('Rent', 'M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 9.5 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5',
        r.yieldPct.toFixed(1) + '%', `${this.inr(this.rent())} a month · ${VACANT_MONTHS} month empty`, N,
        this.INCOME_PCT + '%', `${this.inr(r.dv.dvMonthly)} a month · every month`, G, r.yieldPct > this.INCOME_PCT ? 'fl' : 'dv'),
      row('Risk', 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
        'Medium', 'one building, one city', Y, 'High',
        worst === null ? 'can fall' : `worst 12 months since ${(this.store.data()?.months[0] ?? '').slice(0, 4)}: ${worst < 0 ? '−' : '+'}${Math.abs(worst).toFixed(0)}%`, R, 'fl',
        { gauge: true, aDeg: 0, bDeg: 72 }),
      row('Liquidity', 'M12 2v6M12 22a7 7 0 0 0 7-7c0-4-7-9-7-9s-7 5-7 9a7 7 0 0 0 7 7z', 'Months', 'find a buyer, register', R, '3 days', 'redeem any business day', G, 'dv'),
      row('Entry & exit cost', 'M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 3H8M2 12h20',
        fmtInr(r.flFriction), `${STAMP_PCT}% stamp duty, ${FLAT_REG_PCT}% + 1.5% brokerage`, R, fmtInr(r.dvFriction), '0.005% stamp duty on units', G, 'dv'),
      row('Effort', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', 'Yours', 'tenants, repairs, society', N, 'None', 'we look after it', G, 'dv'),
      row('You can live in it', 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', 'Yes', 'a home if you need one', A, 'No', 'it only pays you', N, 'fl'),
    ];
  });

  readonly explain = computed(() => {
    const r = this.r();
    if (!r) return null;
    return {
      mix: bySleeve(r.dv.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow }))),
      rentNow: this.rent(),
      rentThen: this.rent() / Math.pow(1 + RENT_RISE / 100, Math.max(0, r.years - 1)),
      gap: r.dvTotal - r.flTotal,
    };
  });
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() { this.store.load(); }
  retry(): void { this.store.load(); }
  go(p: 'calc' | 'vs' | 'notes'): void { this.page.set(p); window.scrollTo({ top: 0 }); }
  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  /** an index level (not ₹) */
  nav(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  rate(v: number | null): string { return v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`; }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.page() !== 'calc') this.go('calc'); }
}
