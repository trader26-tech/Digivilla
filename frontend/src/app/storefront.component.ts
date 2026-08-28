import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

export type VariantKey = 'conservative' | 'balanced' | 'aggressive';

/** A risk variant of a property — same ticket, different basket concentration. */
export interface Variant {
  key: VariantKey;
  label: string;
  mix: string;                // basket character (concentration)
  appreciationLow: number;    // tentative annual appreciation %, low
  appreciationHigh: number;   // tentative annual appreciation %, high
  monthlyIncome: number;      // illustrative monthly SWP payout, rupees
}

/** One property tier in the storefront. */
export interface Property {
  key: 'land' | 'flat' | 'apartment' | 'duplex';
  name: string;
  tagline: string;
  price: number;              // ticket size in rupees
  variants: Record<VariantKey, Variant>;
}

/**
 * PropertyNest storefront — the four property tiers a customer can "own".
 * Each is a curated basket of mutual funds; the tier sets the ticket size and
 * each tier offers three risk variants (conservative / balanced / aggressive)
 * so the investor picks the concentration that fits their need.
 */
@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.scss',
})
export class StorefrontComponent {
  readonly variantOrder: VariantKey[] = ['conservative', 'balanced', 'aggressive'];

  /** Which variant is selected for each property (defaults to balanced). */
  selected: Record<string, VariantKey> = {
    land: 'balanced',
    flat: 'balanced',
    apartment: 'balanced',
    duplex: 'balanced',
  };

  readonly properties: Property[] = [
    {
      key: 'land',
      name: 'Land',
      tagline: 'A surveyed plot to start with',
      price: 10_00_000,
      variants: {
        conservative: { key: 'conservative', label: 'Conservative', mix: 'Debt-led — steadier ground, gentle growth', appreciationLow: 7, appreciationHigh: 9, monthlyIncome: 5_800 },
        balanced:     { key: 'balanced',     label: 'Balanced',     mix: 'Debt with a slice of equity',              appreciationLow: 8, appreciationHigh: 11, monthlyIncome: 5_000 },
        aggressive:   { key: 'aggressive',   label: 'Aggressive',   mix: 'Equity-tilted — more growth, less income', appreciationLow: 10, appreciationHigh: 13, monthlyIncome: 3_800 },
      },
    },
    {
      key: 'flat',
      name: 'Flat',
      tagline: 'A compact home, balanced and liquid',
      price: 25_00_000,
      variants: {
        conservative: { key: 'conservative', label: 'Conservative', mix: 'Income-first hybrid, low volatility',       appreciationLow: 8, appreciationHigh: 10, monthlyIncome: 15_000 },
        balanced:     { key: 'balanced',     label: 'Balanced',     mix: 'Balanced between growth and income',        appreciationLow: 9, appreciationHigh: 12, monthlyIncome: 13_500 },
        aggressive:   { key: 'aggressive',   label: 'Aggressive',   mix: 'Equity-heavy hybrid, growth-first',         appreciationLow: 11, appreciationHigh: 14, monthlyIncome: 10_500 },
      },
    },
    {
      key: 'apartment',
      name: 'Apartment',
      tagline: 'A larger residence with room to grow',
      price: 50_00_000,
      variants: {
        conservative: { key: 'conservative', label: 'Conservative', mix: 'Hybrid core — measured, income-steady',     appreciationLow: 9, appreciationHigh: 11, monthlyIncome: 32_000 },
        balanced:     { key: 'balanced',     label: 'Balanced',     mix: 'Equity-tilted — growth with measured risk', appreciationLow: 10, appreciationHigh: 13, monthlyIncome: 29_000 },
        aggressive:   { key: 'aggressive',   label: 'Aggressive',   mix: 'Growth equity — longer horizon',            appreciationLow: 12, appreciationHigh: 15, monthlyIncome: 23_000 },
      },
    },
    {
      key: 'duplex',
      name: 'Duplex',
      tagline: 'A two-storey estate, built to appreciate',
      price: 1_00_00_000,
      variants: {
        conservative: { key: 'conservative', label: 'Conservative', mix: 'Growth core with a debt cushion',           appreciationLow: 10, appreciationHigh: 12, monthlyIncome: 68_000 },
        balanced:     { key: 'balanced',     label: 'Balanced',     mix: 'Growth-led equity, balanced payout',        appreciationLow: 11, appreciationHigh: 14, monthlyIncome: 62_500 },
        aggressive:   { key: 'aggressive',   label: 'Aggressive',   mix: 'Pure growth equity — the longest horizon',  appreciationLow: 13, appreciationHigh: 16, monthlyIncome: 50_000 },
      },
    },
  ];

  variantOf(p: Property): Variant {
    return p.variants[this.selected[p.key]];
  }

  pick(p: Property, v: VariantKey): void {
    this.selected[p.key] = v;
  }

  /** Indian-format rupees: ₹25,00,000. */
  inr(v: number): string {
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }

  /** Compact for tight spots: ₹10L, ₹1Cr. */
  compact(v: number): string {
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
