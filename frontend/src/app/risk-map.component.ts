import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, signal } from '@angular/core';

import {
  ALL_SCHEMES,
  PACKAGES,
  PropertyKey,
  RISK_SHORT,
  VariantKey,
  expectedGrowth,
  riskOf,
  schemeName,
} from './property-package.data';

/** One plotted scheme on the risk × reward map. */
interface Pin {
  property: PropertyKey;
  variant: VariantKey;
  name: string;         // unique dev name (Adyar Grove …)
  propName: string;     // Flat / Land …
  riskWord: string;     // Low / Medium / High risk
  reward: number;       // real expected growth %
  risk: number;         // real volatility %
  color: string;
  x: number; y: number; // 0..1
  cx: number; cy: number; // svg px
}

const PROP_COLOR: Record<PropertyKey, string> = {
  land: 'var(--positive)',
  flat: 'var(--brass)',
  apartment: '#3E6C8E',
  duplex: 'var(--terracotta)',
};

/**
 * Full-screen Risk × Reward map. X = real risk (volatility), Y = real reward
 * (Regular-plan expected return). Every scheme is a labelled pin; a list panel
 * can be opened to see all the values. Tapping a pin selects it.
 */
@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './risk-map.component.html',
  styleUrl: './risk-map.component.scss',
})
export class RiskMapComponent implements OnInit {
  @Input() property: PropertyKey = 'flat';
  @Input() initialVariant: VariantKey = 'balanced';
  @Output() back = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<{ property: PropertyKey; variant: VariantKey }>();

  readonly PACKAGES = PACKAGES;
  readonly legendProps: PropertyKey[] = ['land', 'flat', 'apartment', 'duplex'];

  selected = signal<{ property: PropertyKey; variant: VariantKey }>({ property: 'flat', variant: 'balanced' });
  listOpen = signal(false);

  readonly W = 680;
  readonly H = 520;
  readonly padL = 66;
  readonly padR = 34;
  readonly padT = 40;
  readonly padB = 60;

  ngOnInit(): void {
    this.selected.set({ property: this.property, variant: this.initialVariant });
  }

  goBack(): void { this.back.emit(); }
  toggleList(): void { this.listOpen.update(v => !v); }
  colorOf(p: PropertyKey): string { return PROP_COLOR[p]; }
  propName(p: PropertyKey): string { return PACKAGES[p].name; }

  /** All 12 schemes as pins, de-overlapped inside the plot box. */
  pins = computed<Pin[]>(() => {
    const raws = ALL_SCHEMES.map(s => ({
      ...s,
      reward: expectedGrowth(s.property, s.variant),
      risk: riskOf(s.property, s.variant),
    }));
    const rk = raws.map(r => r.risk), rw = raws.map(r => r.reward);
    const rLo = Math.min(...rk), rHi = Math.max(...rk);
    const wLo = Math.min(...rw), wHi = Math.max(...rw);
    const rSpan = rHi - rLo || 1, wSpan = wHi - wLo || 1;
    const iw = this.W - this.padL - this.padR, ih = this.H - this.padT - this.padB;

    const pins: Pin[] = raws.map(r => {
      const x = (r.risk - rLo) / rSpan, y = (r.reward - wLo) / wSpan;
      return {
        property: r.property, variant: r.variant,
        name: schemeName(r.property, r.variant),
        propName: PACKAGES[r.property].name,
        riskWord: RISK_SHORT[r.variant],
        reward: r.reward, risk: r.risk,
        color: PROP_COLOR[r.property],
        x, y,
        cx: this.padL + x * iw,
        cy: this.padT + (1 - y) * ih,
      };
    });

    // de-overlap (clamped to the box)
    const MIN = 50;
    const minX = this.padL + 12, maxX = this.W - this.padR - 12;
    const minY = this.padT + 20, maxY = this.H - this.padB - 12;
    for (let it = 0; it < 100; it++) {
      let moved = false;
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j];
        let dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
        if (d < MIN) {
          if (d < 0.01) { dx = (i - j) || 1; dy = 1; d = Math.hypot(dx, dy); }
          const push = (MIN - d) / 2, ux = dx / d, uy = dy / d;
          a.cx -= ux * push; a.cy -= uy * push; b.cx += ux * push; b.cy += uy * push;
          moved = true;
        }
      }
      for (const p of pins) { p.cx = Math.max(minX, Math.min(maxX, p.cx)); p.cy = Math.max(minY, Math.min(maxY, p.cy)); }
      if (!moved) break;
    }
    return pins;
  });

  /** Pins sorted for the value list — best reward/risk first. */
  listPins = computed<Pin[]>(() =>
    [...this.pins()].sort((a, b) => (b.reward / b.risk) - (a.reward / a.risk)),
  );

  selectedPin = computed<Pin | null>(() => {
    const s = this.selected();
    return this.pins().find(p => p.property === s.property && p.variant === s.variant) ?? null;
  });

  select(p: Pin): void { this.selected.set({ property: p.property, variant: p.variant }); }
  viewDetail(p: Pin): void { this.openDetail.emit({ property: p.property, variant: p.variant }); }

  get diag() {
    return { x1: this.padL, y1: this.H - this.padB, x2: this.W - this.padR, y2: this.padT };
  }

  pct(v: number | null | undefined, dp = 1): string {
    if (v == null) return '—';
    return v.toFixed(dp) + '%';
  }
  trackPin = (_: number, p: Pin): string => `${p.property}:${p.variant}`;
}
