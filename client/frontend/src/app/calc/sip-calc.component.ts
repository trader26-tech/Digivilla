import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Output, computed, inject, signal } from '@angular/core';

import { AmountDialComponent } from './amount-dial.component';
import { CESS, EQ_EXEMPT, INCOME_RATE, fmtInr, simulateSipIncome, windowFor, ymLabel } from './backtest.model';
import { CalcDataService } from './calc-data.service';
import { yearsAvailable } from './fd-vs-dv.component';
import { bySleeve } from './sleeves';
import { YearCol, YearColsComponent } from './year-cols.component';

/** Short-term gains on the gold fund are taxed at the slab; the SIP screen doesn't ask it. */
const ASSUMED_SLAB = 30;
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
  imports: [CommonModule, AmountDialComponent, YearColsComponent],
  templateUrl: './sip-calc.component.html',
  styleUrls: ['./calc-screen.scss', './sip-calc.component.scss'],
})
export class SipCalcComponent {
  @Output() back = new EventEmitter<void>();
  @Output() talk = new EventEmitter<void>();
  private store = inject(CalcDataService);

  readonly AMOUNTS = AMOUNTS;
  readonly STEPS = STEPS;
  readonly EXEMPT = EQ_EXEMPT;
  readonly SLAB = ASSUMED_SLAB;
  readonly INCOME_PCT = Math.round(INCOME_RATE * 1000) / 10;   // 3.6, not 3.5999…
  readonly cessPct = Math.round((CESS - 1) * 100);
  readonly fmt = fmtInr;
  readonly ym = ymLabel;
  readonly inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

  // ── answers ──
  readonly monthly = signal(25_000);
  readonly step = signal(10);
  readonly years = signal(15);
  readonly picker = signal<'amt' | 'step' | null>(null);
  readonly page = signal<'calc' | 'notes'>('calc');

  readonly failed = this.store.failed;
  readonly yearOpts = computed(() => yearsAvailable(this.store.data()?.months.length ?? null));
  readonly win = computed(() => { const d = this.store.data(); return d ? windowFor(d, this.years()) : null; });
  readonly r = computed(() => { const w = this.win(); return w ? simulateSipIncome(w, this.monthly(), this.step(), ASSUMED_SLAB) : null; });

  /** One column per year: put in · grew · that year's income (gold). */
  readonly yearCols = computed<YearCol[]>(() => (this.r()?.yearly ?? []).map((y) => ({
    tick: 'Y' + y.year, badge: 'Year ' + y.year,
    put: Math.min(y.invested, y.value), grew: Math.max(0, y.value - y.invested), cap: y.payout,
    fields: [
      { label: 'Put in', value: y.invested },
      { label: 'Worth', value: y.valueAfterTax, tone: 'g' as const },
      { label: 'Income', value: y.payout / 12, tone: 'gold' as const, suffix: '/mo' },
    ],
  })));

  /** The plain-language walk-through on "How this is worked out". */
  readonly explain = computed(() => {
    const r = this.r();
    if (!r) return null;
    const mix = bySleeve(r.funds.map((f) => ({ sleeve: f.sleeve, weight: f.weight, start: f.invested, now: f.valueNow })));
    const first = r.yearly[0], last = r.yearly[r.yearly.length - 1];
    return { mix, perInstalment: mix.map((m) => ({ ...m, amt: this.monthly() * m.pct / 100 })), firstIncome: first?.payout ?? 0, lastIncome: last?.payout ?? 0 };
  });

  readonly proxies = computed(() => (this.win()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  constructor() { this.store.load(); }
  retry(): void { this.store.load(); }

  pickYears(y: number): void { this.years.set(y); }
  togglePicker(p: 'amt' | 'step'): void { this.picker.set(this.picker() === p ? null : p); }
  pickAmount(v: number): void { this.monthly.set(v); this.picker.set(null); }
  pickStep(v: number): void { this.step.set(v); this.picker.set(null); }
  go(p: 'calc' | 'notes'): void { this.picker.set(null); this.page.set(p); window.scrollTo({ top: 0 }); }
  rate(v: number | null): string { return v === null || !isFinite(v) ? '—' : `${v.toFixed(1)}%`; }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.picker()) this.picker.set(null);
    else if (this.page() !== 'calc') this.go('calc');
  }
}
