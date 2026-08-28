import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';

import {
  ALL_SCHEMES,
  PACKAGES,
  PropertyKey,
  RISK_SHORT,
  VariantKey,
  schemeLocality,
  schemeName,
} from './property-package.data';
import { BasketMetrics, PropertyDetailService } from './property-detail.service';

/** One plotted property on the risk×reward map. */
interface MapPin {
  property: PropertyKey;
  variant: VariantKey;
  name: string;
  shortName: string;     // compact label, e.g. 'Adyar'
  propName: string;      // 'Flat', 'Land', …
  color: string;         // css var, coloured by property
  riskLabel: string;     // 'Low risk' | 'Medium risk' | 'High risk'
  reward: number;        // expected growth %
  riskPct: number | null; // measured volatility %, if loaded
  rx: number;            // 0..1 normalised risk
  ry: number;            // 0..1 normalised reward
  cx: number;            // px (after de-overlap nudging)
  cy: number;            // px
  labelAbove: boolean;   // place the label above (true) or below the dot
  isSelected: boolean;
}

/** A distinct hue per property so the four tiers are tellable apart. */
const PROP_COLOR: Record<PropertyKey, string> = {
  land: 'var(--positive)',
  flat: 'var(--brass)',
  apartment: '#3E6C8E',   // slate blue
  duplex: 'var(--terracotta)',
};

/**
 * A clean, dedicated risk × reward map page. X = risk (swing), Y = reward
 * (expected growth). Every PropertyNest scheme is plotted; the one the customer
 * tapped is highlighted, so they can see where their pick sits versus all the
 * others. Nothing else on the page — just the map + a small readout.
 */
@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './risk-map.component.html',
  styleUrl: './risk-map.component.scss',
})
export class RiskMapComponent implements OnInit {
  /** The scheme that was tapped — opens highlighted/selected. */
  @Input() property: PropertyKey = 'flat';
  @Input() initialVariant: VariantKey = 'balanced';
  @Output() back = new EventEmitter<void>();

  private api = inject(PropertyDetailService);

  readonly PACKAGES = PACKAGES;

  /** Which pin is selected (defaults to the tapped scheme). */
  selected = signal<{ property: PropertyKey; variant: VariantKey }>({ property: 'flat', variant: 'balanced' });

  /** Measured metrics per scheme key ('property:variant'), for real volatility. */
  metrics = signal<Record<string, BasketMetrics>>({});
  loading = signal(true);

  // chart geometry
  readonly W = 1000;
  readonly H = 720;
  readonly padL = 88;
  readonly padR = 40;
  readonly padT = 56;
  readonly padB = 84;

  ngOnInit(): void {
    this.selected.set({ property: this.property, variant: this.initialVariant });
    this.loadAll();
  }

  goBack(): void { this.back.emit(); }

  private keyOf(p: PropertyKey, v: VariantKey): string { return `${p}:${v}`; }

  /** Load real NAV metrics for every scheme so pins use measured volatility.
   *  The page renders immediately with tier-based risk; pins refine as data lands. */
  loadAll(): void {
    this.loading.set(true);
    let remaining = ALL_SCHEMES.length;
    for (const s of ALL_SCHEMES) {
      const v = PACKAGES[s.property].variants[s.variant];
      const items = v.legs.map(l => ({ scheme_code: l.scheme_code, weight: l.weight }));
      this.api.analyze(items).subscribe({
        next: m => {
          this.metrics.update(cur => ({ ...cur, [this.keyOf(s.property, s.variant)]: m }));
          if (--remaining === 0) this.loading.set(false);
        },
        error: () => { if (--remaining === 0) this.loading.set(false); },
      });
    }
  }

  /** Raw reward (growth %) and risk (measured vol, else tier proxy) per scheme. */
  private raw(property: PropertyKey, variant: VariantKey): { reward: number; risk: number; measured: boolean } {
    const v = PACKAGES[property].variants[variant];
    const reward = v.targetGrowth;
    const tierRisk: Record<VariantKey, number> = { conservative: 10, balanced: 15, aggressive: 22 };
    let risk = tierRisk[variant] + (v.targetGrowth - 8) * 0.4;
    let measured = false;
    const m = this.metrics()[this.keyOf(property, variant)];
    if (m?.volatility != null) { risk = m.volatility; measured = true; }
    return { reward, risk, measured };
  }

  /** All 12 schemes as plotted pins, nudged apart so none overlap. */
  pins = computed<MapPin[]>(() => {
    const sel = this.selected();
    const raws = ALL_SCHEMES.map(s => ({ ...s, ...this.raw(s.property, s.variant) }));
    const risks = raws.map(r => r.risk), rewards = raws.map(r => r.reward);
    const rLo = Math.min(...risks), rHi = Math.max(...risks);
    const wLo = Math.min(...rewards), wHi = Math.max(...rewards);
    const rSpan = rHi - rLo || 1, wSpan = wHi - wLo || 1;
    const innerW = this.W - this.padL - this.padR;
    const innerH = this.H - this.padT - this.padB;

    const pins: MapPin[] = raws.map(r => {
      const rx = (r.risk - rLo) / rSpan;
      const ry = (r.reward - wLo) / wSpan;
      return {
        property: r.property, variant: r.variant,
        name: schemeName(r.property, r.variant),
        shortName: schemeName(r.property, r.variant).split(' ')[0],
        propName: PACKAGES[r.property].name,
        color: PROP_COLOR[r.property],
        riskLabel: RISK_SHORT[r.variant],
        reward: r.reward,
        riskPct: r.measured ? r.risk : null,
        rx, ry,
        cx: this.padL + rx * innerW,
        cy: this.padT + (1 - ry) * innerH,
        labelAbove: true,
        isSelected: r.property === sel.property && r.variant === sel.variant,
      };
    });

    // De-overlap: push apart any two dots closer than MIN_D, clamping to the
    // plot box each pass so they settle spread-out AND inside the frame.
    const MIN_D = 60;
    const minX = this.padL + 16, maxX = this.W - this.padR - 16;
    const minY = this.padT + 30, maxY = this.H - this.padB - 16;
    for (let iter = 0; iter < 120; iter++) {
      let moved = false;
      for (let i = 0; i < pins.length; i++) {
        for (let j = i + 1; j < pins.length; j++) {
          const a = pins[i], b = pins[j];
          let dx = b.cx - a.cx, dy = b.cy - a.cy;
          let d = Math.hypot(dx, dy);
          if (d < MIN_D) {
            if (d < 0.01) { dx = (i - j) || 1; dy = 1; d = Math.hypot(dx, dy); }
            const push = (MIN_D - d) / 2;
            const ux = dx / d, uy = dy / d;
            a.cx -= ux * push; a.cy -= uy * push;
            b.cx += ux * push; b.cy += uy * push;
            moved = true;
          }
        }
      }
      for (const p of pins) {
        p.cx = Math.max(minX, Math.min(maxX, p.cx));
        p.cy = Math.max(minY, Math.min(maxY, p.cy));
      }
      if (!moved) break;
    }
    for (const p of pins) p.labelAbove = p.cy > this.padT + 48;
    return pins;
  });

  selectedPin = computed<MapPin | null>(() => this.pins().find(p => p.isSelected) ?? null);

  /** Reward per unit of risk for the selected pin (higher = better deal). */
  rewardPerRisk = computed<number | null>(() => {
    const p = this.selectedPin();
    if (!p) return null;
    const risk = p.riskPct ?? (10 + p.rx * 14);
    return risk > 0 ? p.reward / risk : null;
  });

  verdict = computed<string>(() => {
    const r = this.rewardPerRisk();
    if (r == null) return '';
    if (r >= 1.0) return 'Strong deal — more reward than the risk you take.';
    if (r >= 0.75) return 'Balanced — reward and risk broadly matched.';
    return 'Racier — you take on more swing for the extra growth.';
  });

  select(p: MapPin): void {
    this.selected.set({ property: p.property, variant: p.variant });
  }

  /** Legend colour for a property. */
  colorOf(p: PropertyKey): string { return PROP_COLOR[p]; }
  /** Properties in legend order. */
  readonly legendProps: PropertyKey[] = ['land', 'flat', 'apartment', 'duplex'];
  propName(p: PropertyKey): string { return PACKAGES[p].name; }

  /** The diagonal "fair value" line endpoints (bottom-left → top-right). */
  get diag() {
    return { x1: this.padL, y1: this.H - this.padB, x2: this.W - this.padR, y2: this.padT };
  }

  pct(v: number | null | undefined, dp = 1): string {
    if (v == null) return '—';
    return v.toFixed(dp) + '%';
  }
  trackPin = (_: number, p: MapPin): string => `${p.property}:${p.variant}`;
}
