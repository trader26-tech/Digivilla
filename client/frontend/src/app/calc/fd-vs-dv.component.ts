import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Output, computed, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import {
  CESS, EQ_EXEMPT, INFLATION, NRI_TDS, PAYOUT_RATE, fmtInr, simulatePayout, windowFor, worstYearPct, ymLabel,
} from './backtest.model';
import { Bars3dComponent, Col3d } from './bars-3d.component';
import { CalcDataService } from './calc-data.service';
import { bySleeve } from './sleeves';

export const FD_RATES = [5.5, 6, 6.5, 7, 7.5, 8];
export const TAX_SLABS = [0, 5, 10, 15, 20, 25, 30];
export const YEAR_OPTS = [5, 8, 10, 15, 20];
/** Only the year tabs real fund history fully covers (it starts Jul 2007, so 20 years is out). */
export function yearsAvailable(months: number | null): number[] {
  return months === null ? YEAR_OPTS.slice(0, -1) : YEAR_OPTS.filter((y) => 12 * y <= months - 1);
}

const G = '#8fd65a';

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
  styleUrls: ['./calc-screen.scss'],
})
export class FdVsDvComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly FD_RATES = FD_RATES;
  readonly TAX_SLABS = TAX_SLABS;
  readonly INFLATION = INFLATION;
  readonly EXEMPT = EQ_EXEMPT;
  readonly cessPct = Math.round((CESS - 1) * 100);
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

  // ── answers ──
  readonly amount = signal(1_00_00_000);
  readonly years = signal(5);
  readonly fdRate = signal(6.5);
  readonly slab = signal(30);
  readonly nri = signal(false);
  readonly tax = computed(() => (this.nri() ? NRI_TDS : this.slab()));

  // ── ui ──
  readonly picker = signal<'rate' | 'tax' | null>(null);
  readonly page = signal<'calc' | 'vs' | 'notes'>('calc');

  // ── data + result ──
  readonly failed = this.store.failed;
  readonly win = computed(() => { const d = this.store.data(); return d ? windowFor(d, this.years()) : null; });
  readonly r = computed(() => { const w = this.win(); return w ? simulatePayout(w, this.amount(), this.fdRate(), this.tax()) : null; });
  /** Risk is a property of the mix, so it's measured over all the history there is. */
  readonly worstEver = computed(() => { const d = this.store.data(); return d ? worstYearPct(windowFor(d, 100)) : null; });
  readonly historyYear = computed(() => (this.store.data()?.months[0] ?? '').slice(0, 4));
  readonly payout = computed(() => this.amount() * PAYOUT_RATE);
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));

  readonly fdCol = computed<Col3d | null>(() => {
    const r = this.r();
    if (!r) return null;
    return { art: 'bank', segs: [
      { label: 'Paid out', val: r.fdPaid, bg: 'linear-gradient(180deg,#6d7184,#585c6e)', side: '#454858', top: '#8b8fa3', k: '#d9dbe6', c: '#f2f2f6' },
      { label: 'Value', val: r.fdValue, bg: 'linear-gradient(180deg,#3a3d4a,#2b2e3a)', side: '#20222d', k: '#b2b6ca', c: '#e4e7f5' },
    ] };
  });
  readonly dvCol = computed<Col3d | null>(() => {
    const r = this.r();
    if (!r) return null;
    return { art: 'villa', coin: true, green: true, segs: [
      { label: 'Paid out', val: r.dvPaid, bg: 'linear-gradient(180deg,#b9e69a,#9ad471)', side: '#7fb85a', top: '#d3f0bd', k: '#2b4d18', c: '#10240a' },
      { label: 'Growth', val: r.dvValue, bg: 'linear-gradient(180deg,#4f9528,#2a5e18)', side: '#1f4a13', top: '#6cba36', k: '#d8f2c4', c: '#f2fbe9' },
    ] };
  });

  /** Side by side — the parts that matter. */
  readonly vs = computed(() => {
    const r = this.r();
    if (!r) return [];
    const A = '#c9c6da', N = '#e4e7f5', R = '#e0796b';
    const row = (k: string, icon: string, a: string, as: string, ac: string, b: string, bs: string, bc: string, win: 'fd' | 'dv') =>
      ({ k, icon, a, as, ac, b, bs, bc, win, gauge: false, aDeg: 0, bDeg: 0 });
    const worst = this.worstEver();
    const arbLine = r.arbEmptyMonth
      ? `ran out ${ymLabel(r.arbEmptyMonth)}; growth funds pay since`
      : `${Math.round(r.arbStartPct)}% → ${r.arbNowPct.toFixed(0)}% of the villa`;
    return [
      row('Certainty', 'M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z', 'Certain', 'written in the contract', A, 'Not certain', 'the past isn’t a promise', N, 'fd'),
      { ...row('Risk', 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
          'Low', 'never falls', A, 'High',
          worst === null ? 'can fall' : `worst 12 months since ${this.historyYear()}: ${this.pct(worst, 0)}`, R, 'fd'),
        gauge: true, aDeg: -72, bDeg: 72 },
      row('Real value', 'M3 12h4l3-8 4 16 3-8h4', fmtInr(r.fdReal), 'in today’s money', r.fdReal < this.amount() ? R : N, fmtInr(r.dvReal), 'in today’s money', G, 'dv'),
      row('Compounding', 'M4 20 20 4M4 20v-6M4 20h6M20 4h-6M20 4v6', 'None', 'interest is paid out', N,
        (r.dvValue >= this.amount() ? '+' : '') + fmtInr(r.dvValue - this.amount()), `${fmtInr(this.amount())} is now ${fmtInr(r.dvValue)}`, G, 'dv'),
      row('Income', 'M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 9.5 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5',
        this.inr(r.fdMonthly), 'a month after tax, never grows', N, this.inr(r.dvMonthly), 'a month, every month', G, 'dv'),
      row('Paid from', 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z', 'Interest', 'principal untouched', N, 'Arbitrage', arbLine, G, 'dv'),
    ];
  });

  /** The plain-language walk-through on "How this is worked out". */
  readonly explain = computed(() => {
    const r = this.r();
    if (!r) return null;
    const mix = bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.valueStart, now: f.valueNow })));
    const fdGross = this.amount() * this.fdRate() / 1200;
    return {
      mix,
      payments: r.months.length - 1,
      fdGross,
      taxTiny: r.dvPayoutTax < r.dvPaidGross * 0.01,
      gap: r.dvTotal - r.fdTotal,
    };
  });

  /** Funds younger than the window: whose returns stood in, and until when. */
  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() { this.store.load(); }
  retry(): void { this.store.load(); }

  togglePicker(p: 'rate' | 'tax'): void { this.picker.set(this.picker() === p ? null : p); }
  pickRate(r: number): void { this.fdRate.set(r); this.picker.set(null); }
  pickSlab(s: number): void { this.nri.set(false); this.slab.set(s); this.picker.set(null); }
  pickNri(): void { this.nri.set(true); this.picker.set(null); }
  go(p: 'calc' | 'vs' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }

  units(v: number): string { return v.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
  nav(v: number): string { return '₹' + v.toFixed(2); }
  pct(v: number | null, d = 1): string { return v === null || !isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}%`; }
  rate(v: number | null): string { return v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`; }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
