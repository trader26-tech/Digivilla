import { CommonModule } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

import {
  Leg,
  PACKAGES,
  PropertyKey,
  TAX_NOTE,
  VariantKey,
  runwayMonths,
  totalMonthlyIncome,
} from './property-package.data';

/**
 * "How you get paid" — a self-contained visual explainer for the monthly
 * income of an income-tier estate (Flat / Apartment / Duplex). Drop it into
 * any detail page with [property] + [variant]; every figure is read from the
 * shared PACKAGES data, so it auto-adjusts to the tier and risk variant.
 *
 * It answers, visually and step by step:
 *   1. HOW MUCH you get per month.
 *   2. WHICH fund it comes from (the arbitrage income sleeve).
 *   3. HOW it reaches you — an automatic SWP credited to your bank each month.
 *   4. HOW it keeps going — the annual growth→income top-up, and the
 *      emergency reserve / runway that protect the payout.
 */
@Component({
  selector: 'app-income-flow',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './income-flow.component.html',
  styleUrl: './income-flow.component.scss',
})
export class IncomeFlowComponent {
  @Input({ required: true }) property!: PropertyKey;
  @Input({ required: true }) variant!: VariantKey;

  readonly taxNote = TAX_NOTE;

  pkg = computed(() => PACKAGES[this.property]);
  v = computed(() => PACKAGES[this.property].variants[this.variant]);

  /** Total monthly income the customer receives. */
  monthly = computed<number>(() => totalMonthlyIncome(this.v()));

  /** The income-sleeve legs (arbitrage / equity-savings) that the SWP runs on. */
  incomeLegs = computed<Leg[]>(() => this.v().legs.filter(l => l.role === 'income'));
  /** The single primary payer (largest monthly draw) — for the "from" line. */
  primaryLeg = computed<Leg | null>(() => {
    const legs = this.incomeLegs().filter(l => l.withdrawMonthly > 0);
    if (!legs.length) return null;
    return legs.reduce((a, b) => (b.withdrawMonthly > a.withdrawMonthly ? b : a));
  });

  incomeCorpus = computed<number>(() =>
    this.v().legs.filter(l => l.role === 'income').reduce((s, l) => s + l.weight * this.pkg().price, 0),
  );
  growthCorpus = computed<number>(() =>
    this.v().legs.filter(l => l.role === 'growth').reduce((s, l) => s + l.weight * this.pkg().price, 0),
  );
  liquidCorpus = computed<number>(() =>
    this.v().legs.filter(l => l.role === 'liquid').reduce((s, l) => s + l.weight * this.pkg().price, 0),
  );
  hasLiquid = computed<boolean>(() => this.liquidCorpus() > 0);

  /** Months of rent already sitting in the income sleeve = the runway. */
  runway = computed<number>(() => runwayMonths(this.v(), this.pkg().price));
  runwayPct = computed<number>(() => Math.min(100, (this.runway() / 24) * 100));

  /** Per-year top-up the growth engine sends the income sleeve (~1 year of rent). */
  annualTopUp = computed<number>(() => this.monthly() * 12);

  /** Show/hide the "why it's tax-efficient" detail. */
  taxOpen = signal(false);
  toggleTax(): void { this.taxOpen.update(v => !v); }

  // formatting
  inr(v: number | null | undefined): string {
    if (v == null) return '—';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  compact(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v >= 1_00_00_000) {
      const cr = v / 1_00_00_000;
      return '₹' + (cr % 1 === 0 ? cr : cr.toFixed(2).replace(/\.?0+$/, '')) + 'Cr';
    }
    if (v >= 1_00_000) {
      const l = v / 1_00_000;
      return '₹' + (l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')) + 'L';
    }
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
}
