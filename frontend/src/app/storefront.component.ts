import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Output } from '@angular/core';

import {
  storeSchemeName, storeSchemeLocality,
  expectedGrowth, past3y, RISK_OF_STORE,
  riskScore, RiskScore,
} from './property-package.data';
import { inr, compact } from './shared/format.util';

export type VariantKey = 'ready' | 'construction' | 'prelaunch';
export type FilterKey = 'all' | 'income' | 'growth' | 'ready' | 'construction' | 'prelaunch';

/** A risk variant of a property, named in property terms rather than fund jargon:
 *   ready        = Ready-to-move  → income now, steadier (conservative)
 *   construction = Under construction → balanced
 *   prelaunch    = Pre-launch     → most appreciation, less income (aggressive)
 * Same ticket, different basket concentration. */
export interface Variant {
  key: VariantKey;
  label: string;              // property-world name
  growthPct: number;          // expected annual growth %, p.a. (illustrative)
  past3y: number;             // past 3-year return, annualised % (illustrative)
  monthlyIncome: number | null; // illustrative monthly rent/SWP — null for pure-growth (Land)
}

/** One property tier in the storefront. */
export interface Property {
  key: 'land' | 'flat' | 'apartment' | 'duplex';
  name: string;
  price: number;              // ticket size in rupees
  /** Land is pure growth — it pays no monthly income (no SWP). */
  incomePays: boolean;
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
  imports: [CommonModule, FormsModule],
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.scss',
})
export class StorefrontComponent {
  inr = inr;
  compact = compact;
  readonly variantOrder: VariantKey[] = ['ready', 'construction', 'prelaunch'];

  /** Fires when the customer opens a tier's detail page. Emits the property
   *  and which risk variant they tapped, so the detail page opens on that one. */
  @Output() openProperty = new EventEmitter<{
    property: Property['key'];
    variant: 'conservative' | 'balanced' | 'aggressive';
  }>();

  /** Back to the estate home. */
  @Output() back = new EventEmitter<void>();

  /** Map the storefront's property-world variant names onto the basket risk
   *  profiles. Same mapping for every tier. */
  private static readonly RISK_OF: Record<VariantKey, 'conservative' | 'balanced' | 'aggressive'> = {
    ready: 'conservative',
    construction: 'balanced',
    prelaunch: 'aggressive',
  };

  /** Selected property chip. 'all' shows every property's variants. */
  activeKey: Property['key'] | 'all' = 'all';
  /** Search text. */
  query = '';

  /** Filter by need. */
  filterOpen = false;
  filter: FilterKey = 'all';
  readonly filterOptions: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All estates' },
    { key: 'income', label: 'Monthly income' },
    { key: 'growth', label: 'Pure growth' },
    { key: 'ready', label: 'Ready-to-move' },
    { key: 'construction', label: 'Under construction' },
    { key: 'prelaunch', label: 'Pre-launch' },
  ];
  get filterLabel(): string {
    return this.filterOptions.find((o) => o.key === this.filter)?.label ?? 'Filter';
  }

  /** All variant tiles, after chip + search + filter. */
  get tiles(): { p: Property; v: Variant }[] {
    const q = this.query.trim().toLowerCase();
    const out: { p: Property; v: Variant }[] = [];
    for (const p of this.properties) {
      if (this.activeKey !== 'all' && p.key !== this.activeKey) continue;
      if (this.filter === 'income' && !p.incomePays) continue;
      if (this.filter === 'growth' && p.incomePays) continue;
      for (const vk of this.variantOrder) {
        if (['ready', 'construction', 'prelaunch'].includes(this.filter) && this.filter !== vk) continue;
        const v = p.variants[vk];
        if (q && !(`${v.label} ${p.name}`).toLowerCase().includes(q)) continue;
        out.push({ p, v });
      }
    }
    return out;
  }

  /** Chips: 'All' plus each property; those matching the search stay visible. */
  get chips(): (Property | { key: 'all'; name: string })[] {
    const q = this.query.trim().toLowerCase();
    const props = q ? this.properties.filter((p) => p.name.toLowerCase().includes(q)) : this.properties;
    return [{ key: 'all', name: 'All' }, ...props];
  }

  selectChip(key: Property['key'] | 'all'): void {
    this.activeKey = key;
  }

  onQuery(v: string): void {
    this.query = v;
    const chips = this.chips;
    if (this.activeKey !== 'all' && !chips.some((c) => c.key === this.activeKey)) {
      this.activeKey = 'all';
    }
  }

  pickFilter(key: FilterKey): void {
    this.filter = key;
    this.filterOpen = false;
  }

  /** Open any tier's detail page, on the tapped risk variant (default balanced). */
  open(p: Property, vk?: VariantKey): void {
    const variant = vk ? StorefrontComponent.RISK_OF[vk] : 'balanced';
    this.openProperty.emit({ property: p.key, variant });
  }

  /** The development name for a tile — from the shared SCHEME_META (single
   *  source of truth; now the Chennai locality names). Keeps tile↔detail in sync. */
  schemeName(p: Property, vk: VariantKey): string {
    return storeSchemeName(p.key, vk);
  }
  /** The short locality/tagline for a scheme. */
  schemeLocality(p: Property, vk: VariantKey): string {
    return storeSchemeLocality(p.key, vk);
  }

  /** Real expected annual growth % — from REAL_METRICS (single source of truth),
   *  so the tile matches the detail page exactly. */
  growthOf(p: Property, vk: VariantKey): number {
    return expectedGrowth(p.key, RISK_OF_STORE[vk]);
  }
  /** Real trailing 3-year return %, same source. */
  past3yOf(p: Property, vk: VariantKey): number {
    return past3y(p.key, RISK_OF_STORE[vk]);
  }

  /** Combined 0–10 risk score for a tile (volatility + beta + Sharpe folded
   *  into one number), plus the sub-metrics behind it for the reveal. */
  riskOf(p: Property, vk: VariantKey): RiskScore {
    return riskScore(p.key, RISK_OF_STORE[vk]);
  }

  /** Which tile's growth breakdown is open (one at a time). Keyed property·variant. */
  openWhy: string | null = null;
  private whyKey(p: Property, vk: VariantKey): string { return `${p.key}·${vk}`; }
  isWhyOpen(p: Property, vk: VariantKey): boolean { return this.openWhy === this.whyKey(p, vk); }
  toggleWhy(p: Property, vk: VariantKey, ev: Event): void {
    ev.stopPropagation();   // don't open the detail page
    const k = this.whyKey(p, vk);
    this.openWhy = this.openWhy === k ? null : k;
  }

  // Figures from the PropertyNest package data. growthPct = expected p.a.;
  // past3y = illustrative trailing 3-yr return; monthlyIncome = rent (null = Land).
  readonly properties: Property[] = [
    {
      key: 'land',
      name: 'Land',
      price: 10_00_000,
      incomePays: false,   // accumulation only — no monthly withdrawal
      variants: {
        ready:        { key: 'ready',        label: 'Low risk · low returns',      growthPct: 10.2, past3y: 13.4, monthlyIncome: null },
        construction: { key: 'construction', label: 'Medium risk · medium returns', growthPct: 11.8, past3y: 15.6, monthlyIncome: null },
        prelaunch:    { key: 'prelaunch',    label: 'High risk · high returns',         growthPct: 12.9, past3y: 18.2, monthlyIncome: null },
      },
    },
    {
      key: 'flat',
      name: 'Flat',
      price: 25_00_000,
      incomePays: true,
      variants: {
        ready:        { key: 'ready',        label: 'Low risk · low returns',      growthPct: 8.3,  past3y: 10.6, monthlyIncome: 5_000 },
        construction: { key: 'construction', label: 'Medium risk · medium returns', growthPct: 9.6,  past3y: 12.4, monthlyIncome: 6_250 },
        prelaunch:    { key: 'prelaunch',    label: 'High risk · high returns',         growthPct: 10.3, past3y: 13.8, monthlyIncome: 7_500 },
      },
    },
    {
      key: 'apartment',
      name: 'Apartment',
      price: 50_00_000,
      incomePays: true,
      variants: {
        ready:        { key: 'ready',        label: 'Low risk · low returns',      growthPct: 8.3,  past3y: 10.6, monthlyIncome: 10_000 },
        construction: { key: 'construction', label: 'Medium risk · medium returns', growthPct: 9.5,  past3y: 12.4, monthlyIncome: 12_500 },
        prelaunch:    { key: 'prelaunch',    label: 'High risk · high returns',         growthPct: 10.5, past3y: 14.0, monthlyIncome: 15_000 },
      },
    },
    {
      key: 'duplex',
      name: 'Duplex',
      price: 99_00_000,
      incomePays: true,
      variants: {
        ready:        { key: 'ready',        label: 'Low risk · low returns',      growthPct: 8.3,  past3y: 10.6, monthlyIncome: 19_800 },
        construction: { key: 'construction', label: 'Medium risk · medium returns', growthPct: 9.5,  past3y: 12.4, monthlyIncome: 24_750 },
        prelaunch:    { key: 'prelaunch',    label: 'High risk · high returns',         growthPct: 10.6, past3y: 14.1, monthlyIncome: 29_700 },
      },
    },
  ];

  /** Indian-format rupees: ₹25,00,000. */
  /** Compact for tight spots: ₹10L, ₹1Cr. */
}
