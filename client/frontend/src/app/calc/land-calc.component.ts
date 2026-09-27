import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, computed, effect, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact } from '../shared/format.util';
import {
  BasketGrowth, CalcService, ChartSeries, ENTRY_COST_PCT, EXIT_COST_PCT,
  cagrPct, monthsBetween, yearsSince,
} from './calc.service';
import { GrowthChartComponent } from './growth-chart.component';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Land calculator — the land's real CAGR from what you paid, when, and what it's
 * worth now; then what the same money would be worth today had it gone into your
 * own fund basket instead (real NAV history, lump sum, no withdrawals).
 */
@Component({
  selector: 'app-land-calc',
  standalone: true,
  imports: [CommonModule, GrowthChartComponent, MfDisclaimerComponent],
  templateUrl: './land-calc.component.html',
  styleUrl: './land-calc.component.scss',
})
export class LandCalcComponent implements OnDestroy {
  @Output() back = new EventEmitter<void>();
  private calc = inject(CalcService);
  compact = compact;
  readonly MONTHS = MONTHS;

  private readonly now = new Date();
  readonly years: number[] = Array.from({ length: this.now.getFullYear() - 1979 }, (_, i) => this.now.getFullYear() - i);

  // ── inputs (a worked example so the result shows immediately; all editable) ──
  readonly price = signal(10_00_000);
  readonly current = signal(25_00_000);
  readonly buyYear = signal(2015);
  readonly buyMonth = signal(6);             // 1..12
  readonly withCosts = signal(false);
  readonly entryPct = signal(ENTRY_COST_PCT);
  readonly exitPct = signal(EXIT_COST_PCT);
  readonly showBasket = signal(false);

  // ── derived ──
  readonly startYm = computed(() => `${this.buyYear()}-${String(this.buyMonth()).padStart(2, '0')}`);
  readonly thisYm = `${this.now.getFullYear()}-${String(this.now.getMonth() + 1).padStart(2, '0')}`;
  readonly future = computed(() => this.startYm() > this.thisYm);
  readonly heldYears = computed(() => yearsSince(this.startYm(), this.now));
  readonly valid = computed(() => this.price() > 0 && this.current() > 0 && !this.future() && this.heldYears() >= 1 / 12);

  /** What you actually put in / would take out, with or without property costs. */
  readonly outlay = computed(() => this.price() * (this.withCosts() ? 1 + this.entryPct() / 100 : 1));
  readonly landNet = computed(() => this.current() * (this.withCosts() ? 1 - this.exitPct() / 100 : 1));

  readonly priceCagr = computed(() => cagrPct(this.price(), this.current(), this.heldYears()));
  /** Always net of the (editable) property costs, whether or not the toggle is on
   *  — the hint under the headline quotes it when costs are off. */
  readonly netCagr = computed(() => cagrPct(
    this.price() * (1 + this.entryPct() / 100), this.current() * (1 - this.exitPct() / 100), this.heldYears()));
  /** The headline: the price CAGR, or net-of-costs when costs are on. */
  readonly landCagr = computed(() => (this.withCosts() ? this.netCagr() : this.priceCagr()));
  readonly multiple = computed(() => (this.outlay() > 0 ? this.landNet() / this.outlay() : 0));

  // ── the basket (fetched once per start month at ₹1L, scaled here) ──
  readonly ref = signal<BasketGrowth | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  private sub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;

  readonly basket = computed(() => {
    const r = this.ref();
    return r && this.valid() ? CalcService.scale(r, this.outlay()) : null;
  });
  readonly diff = computed(() => {
    const b = this.basket();
    return b ? b.final_value - this.landNet() : 0;
  });
  /** Years the basket was actually invested (less than the land's when clamped). */
  readonly basketYears = computed(() => this.basket()?.years ?? 0);
  readonly diffPct = computed(() => (this.landNet() > 0 ? (this.diff() / this.landNet()) * 100 : 0));

  readonly chart = computed<ChartSeries[]>(() => {
    const b = this.basket(), g = this.landCagr();
    if (!b || g === null) return [];
    // The land has two known points (what you paid, what it's worth), so its line
    // is drawn at its average yearly growth — dashed, to say it's a smoothed path.
    const end = b.end;
    const months = monthsBetween(this.startYm(), end);
    const rate = 1 + g / 100;
    const land = months.map((m, i) => ({
      date: m,
      value: Math.round(i === months.length - 1 ? this.landNet() : this.outlay() * Math.pow(rate, i / 12)),
    }));
    return [
      { label: 'Your basket', color: '#8B7BF0', points: b.series, area: true },
      { label: 'Your land (avg. growth)', color: '#E9C15C', points: land, dashed: true },
    ];
  });

  constructor() {
    // Re-fetch only when the purchase month changes (debounced while scrolling
    // the pickers); amount changes rescale the cached result instantly.
    effect(() => {
      const ym = this.startYm();
      if (this.future()) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.load(ym), 350);
    }, { allowSignalWrites: true });
  }

  load(ym = this.startYm()): void {
    this.sub?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    this.sub = this.calc.basketGrowthRef(ym).subscribe((r) => {
      if (ym !== this.startYm()) return;           // a newer month was picked
      this.ref.set(r);
      this.failed.set(!r);
      this.loading.set(false);
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); clearTimeout(this.timer); }

  // ── input helpers: ₹ with Indian grouping as you type ──
  money(v: number): string { return v ? v.toLocaleString('en-IN') : ''; }
  onMoney(e: Event, target: 'price' | 'current'): void {
    const el = e.target as HTMLInputElement;
    const n = Number(el.value.replace(/[^\d]/g, '').slice(0, 12)) || 0;
    (target === 'price' ? this.price : this.current).set(n);
    el.value = this.money(n);
  }
  onPct(e: Event, target: 'entry' | 'exit'): void {
    const n = Math.max(0, Math.min(50, Number((e.target as HTMLInputElement).value) || 0));
    (target === 'entry' ? this.entryPct : this.exitPct).set(n);
  }
  num(e: Event): number { return Number((e.target as HTMLSelectElement).value); }

  pctText(v: number | null): string {
    if (v === null || !isFinite(v)) return '—';
    return `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(1)}%`;
  }
  ym(m: string): string {
    const [y, mo] = m.split('-').map(Number);
    return `${MONTHS[mo - 1]} ${y}`;
  }
  yearsText(y: number): string {
    return y < 1 ? `${Math.max(1, Math.round(y * 12))} months` : `${y.toFixed(y < 10 ? 1 : 0)} years`;
  }
}
