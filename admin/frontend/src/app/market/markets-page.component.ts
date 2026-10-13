import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { MarketChartComponent } from './market-chart.component';
import { WorldTodayComponent } from './world-today.component';

/** "Villas vs market": today's world markets, and the villas replayed against the Indian indices. */
@Component({
  selector: 'app-markets-page',
  standalone: true,
  imports: [CommonModule, MarketChartComponent, WorldTodayComponent],
  template: `
    <div class="mk">
      <div class="mk-head">
        <h1>Villas vs market</h1>
        <p>How the three villas have done against Indian indices — and how markets around the world are moving, in US dollars or each market’s own currency.</p>
      </div>
      <app-market-chart class="mk-chart"></app-market-chart>
      <app-world-today class="mk-world"></app-world-today>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mk { max-width: 1320px; margin: 0 auto; padding: 28px 32px 56px; animation: mkIn .3s ease both; }
    @keyframes mkFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes mkIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .mk-head { margin-bottom: 18px; }
    .mk-world { display: block; margin-top: 34px; }
    h1 { margin: 0; font-size: 1.7rem; font-weight: 800; letter-spacing: -0.02em; color: var(--ink); }
    .mk-head p { margin: 4px 0 0; max-width: 760px; font-size: 0.92rem; color: var(--muted); }
    .mk-chart { display: block; height: 660px; }
    @media (max-width: 760px) {
      /* fade only: a transform left on .mk (even identity) would trap the chart's position:fixed bottom sheet */
      .mk { padding: 16px 12px 32px; animation-name: mkFade; }
      .mk-head { margin-bottom: 14px; padding: 0 2px; }
      h1 { font-size: 1.45rem; }
      .mk-head p { font-size: 0.86rem; line-height: 1.45; }
      /* the chart panel grows with its content on phones (it fills a fixed cell on desktop) */
      .mk-chart { height: auto; }
      .mk-world { margin-top: 28px; }
    }
    @media (prefers-reduced-motion: reduce) { .mk { animation: none; } }
  `],
})
export class MarketsPageComponent {}
