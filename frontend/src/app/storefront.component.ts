import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

export type VariantKey = 'ready' | 'construction' | 'prelaunch';

/** A risk variant of a property, named in property terms rather than fund jargon:
 *   ready        = Ready-to-move  → income now, steadier (conservative)
 *   construction = Under construction → balanced
 *   prelaunch    = Pre-launch     → most appreciation, less income (aggressive)
 * Same ticket, different basket concentration. */
export interface Variant {
  key: VariantKey;
  label: string;              // property-world name
  note: string;               // one short plain-English hint
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
  readonly variantOrder: VariantKey[] = ['ready', 'construction', 'prelaunch'];

  /** Which variant is selected for each property (defaults to balanced). */
  selected: Record<string, VariantKey> = {
    land: 'construction',
    flat: 'construction',
    apartment: 'construction',
    duplex: 'construction',
  };

  /** Which row is expanded (only one at a time). null = all collapsed. */
  openKey: string | null = null;

  readonly properties: Property[] = [
    {
      key: 'land',
      name: 'Land',
      tagline: 'A surveyed plot to start with',
      price: 10_00_000,
      variants: {
        ready:        { key: 'ready',        label: 'Ready-to-move',       note: 'Highest income, steadiest',     appreciationLow: 7,  appreciationHigh: 9,  monthlyIncome: 5_800 },
        construction: { key: 'construction', label: 'Under construction',  note: 'Balanced income and growth',    appreciationLow: 8,  appreciationHigh: 11, monthlyIncome: 5_000 },
        prelaunch:    { key: 'prelaunch',    label: 'Pre-launch',          note: 'Most growth, less income now',  appreciationLow: 10, appreciationHigh: 13, monthlyIncome: 3_800 },
      },
    },
    {
      key: 'flat',
      name: 'Flat',
      tagline: 'A compact home, balanced and liquid',
      price: 25_00_000,
      variants: {
        ready:        { key: 'ready',        label: 'Ready-to-move',       note: 'Highest income, steadiest',     appreciationLow: 8,  appreciationHigh: 10, monthlyIncome: 15_000 },
        construction: { key: 'construction', label: 'Under construction',  note: 'Balanced income and growth',    appreciationLow: 9,  appreciationHigh: 12, monthlyIncome: 13_500 },
        prelaunch:    { key: 'prelaunch',    label: 'Pre-launch',          note: 'Most growth, less income now',  appreciationLow: 11, appreciationHigh: 14, monthlyIncome: 10_500 },
      },
    },
    {
      key: 'apartment',
      name: 'Apartment',
      tagline: 'A larger residence with room to grow',
      price: 50_00_000,
      variants: {
        ready:        { key: 'ready',        label: 'Ready-to-move',       note: 'Highest income, steadiest',     appreciationLow: 9,  appreciationHigh: 11, monthlyIncome: 32_000 },
        construction: { key: 'construction', label: 'Under construction',  note: 'Balanced income and growth',    appreciationLow: 10, appreciationHigh: 13, monthlyIncome: 29_000 },
        prelaunch:    { key: 'prelaunch',    label: 'Pre-launch',          note: 'Most growth, less income now',  appreciationLow: 12, appreciationHigh: 15, monthlyIncome: 23_000 },
      },
    },
    {
      key: 'duplex',
      name: 'Duplex',
      tagline: 'A two-storey estate, built to appreciate',
      price: 1_00_00_000,
      variants: {
        ready:        { key: 'ready',        label: 'Ready-to-move',       note: 'Highest income, steadiest',     appreciationLow: 10, appreciationHigh: 12, monthlyIncome: 68_000 },
        construction: { key: 'construction', label: 'Under construction',  note: 'Balanced income and growth',    appreciationLow: 11, appreciationHigh: 14, monthlyIncome: 62_500 },
        prelaunch:    { key: 'prelaunch',    label: 'Pre-launch',          note: 'Most growth, less income now',  appreciationLow: 13, appreciationHigh: 16, monthlyIncome: 50_000 },
      },
    },
  ];

  toggle(p: Property): void {
    this.openKey = this.openKey === p.key ? null : p.key;
  }
  isOpen(p: Property): boolean {
    return this.openKey === p.key;
  }

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
