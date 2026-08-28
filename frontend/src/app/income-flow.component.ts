import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, computed, signal } from '@angular/core';

import {
  PACKAGES,
  PropertyKey,
  VariantKey,
  totalMonthlyIncome,
} from './property-package.data';

/**
 * "How you get paid" — a VISUAL, animated explainer for the monthly income of
 * one income-tier estate. Drop in with [property] + [variant]; it shows only
 * that estate. The money splits into three plain buckets (Rent / Growth /
 * Safety), and a short animation shows rent dropping into your bank each month,
 * the Growth bucket rising, and Growth topping the Rent bucket up once a year.
 * Minimal words, no fund jargon — the picture does the explaining.
 */
@Component({
  selector: 'app-income-flow',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './income-flow.component.html',
  styleUrl: './income-flow.component.scss',
})
export class IncomeFlowComponent implements OnDestroy {
  @Input({ required: true }) property!: PropertyKey;
  @Input({ required: true }) variant!: VariantKey;

  pkg = computed(() => PACKAGES[this.property]);
  v = computed(() => PACKAGES[this.property].variants[this.variant]);

  monthly = computed<number>(() => totalMonthlyIncome(this.v()));

  /** Three simple buckets, in rupees — no fund names. */
  buckets = computed(() => {
    const price = this.pkg().price;
    const legs = this.v().legs;
    const rent = legs.filter(l => l.role === 'income').reduce((s, l) => s + l.weight * price, 0);
    const growth = legs.filter(l => l.role === 'growth').reduce((s, l) => s + l.weight * price, 0);
    const safety = legs.filter(l => l.role === 'liquid' || l.role === 'hedge').reduce((s, l) => s + l.weight * price, 0);
    return {
      total: price,
      rent, growth, safety,
      rentPct: Math.round((rent / price) * 100),
      growthPct: Math.round((growth / price) * 100),
      safetyPct: Math.round((safety / price) * 100),
    };
  });

  /** ── The 6 simple points (no jargon) ──────────────────────────── */
  points = computed(() => {
    const b = this.buckets();
    const m = this.monthly();
    return [
      { icon: '🧺', text: `Your ${this.compact(b.total)} is split into 3 pots.` },
      { icon: '🏦', text: `Every month, ${this.inr(m)} is sent straight to your bank.` },
      { icon: '💧', text: `That monthly money comes from the Rent pot.` },
      { icon: '📈', text: `The Growth pot keeps growing in the background.` },
      { icon: '🔁', text: `Once a year, Growth tops the Rent pot back up.` },
      { icon: '🛟', text: `A Safety pot covers you if a month goes bad.` },
      { icon: '🧾', text: `You pay almost no tax on this income.` },
    ];
  });

  // ── Animation: step 0..4 ────────────────────────────────────────
  step = signal(0);
  playing = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  readonly lastStep = 4;

  /** Growth-pot height grows a little at each later step (for the rising effect). */
  growthLift = computed<number>(() => {
    const s = this.step();
    // 0% extra at step<=1, up to ~26% taller by the end
    return s <= 1 ? 0 : Math.min(26, (s - 1) * 9);
  });
  /** Whether a coin is dropping to the bank (steps 2+). */
  paying = computed<boolean>(() => this.step() >= 2);
  /** Whether the yearly refill arrow shows (step 3+). */
  refilling = computed<boolean>(() => this.step() >= 3);

  play(): void {
    if (this.playing()) { this.pause(); return; }
    if (this.step() >= this.lastStep) this.step.set(0);
    this.playing.set(true);
    this.timer = setInterval(() => {
      if (this.step() >= this.lastStep) { this.pause(); return; }
      this.step.update(s => s + 1);
    }, 1400);
  }
  pause(): void {
    this.playing.set(false);
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
  goToStep(n: number): void { this.pause(); this.step.set(n); }
  ngOnDestroy(): void { this.pause(); }

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
