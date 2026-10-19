import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { MarketChartComponent } from './market-chart.component';
import { WorldTodayComponent } from './world-today.component';

/** "Villas vs market": the villas replayed against the Indian indices, then today's world markets. */
@Component({
  selector: 'app-markets-page',
  standalone: true,
  imports: [CommonModule, MarketChartComponent, WorldTodayComponent],
  template: `
    <div class="mk">
      <header class="mk-head"><h1>Villas vs market</h1></header>
      <app-market-chart class="mk-chart"></app-market-chart>
      <app-world-today class="mk-world"></app-world-today>
    </div>
  `,
  styles: [`
    :host { display: block; background: var(--nw-bg); color: var(--nw-text); -webkit-font-smoothing: antialiased; }
    .mk { max-width: 1680px; margin: 0 auto; padding: 18px 32px 40px; animation: mkIn .25s ease both; }
    @keyframes mkFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes mkIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .mk-head { margin-bottom: 12px; }
    h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -.6px; line-height: 1.15; color: var(--nw-text); }
    .mk-chart { display: block; height: 700px; }
    .mk-world { display: block; margin-top: 12px; }
    @media (max-width: 900px) {
      /* fade only: a transform left on .mk (even identity) would trap the chart's position:fixed bottom sheet */
      .mk { padding: 14px 12px calc(28px + var(--tabbar-h, 0px)); animation-name: mkFade; }
      .mk-head { margin-bottom: 10px; }
      h1 { font-size: 22px; }
    }
    @media (max-width: 760px) {
      /* the chart panel grows with its content on phones (it fills a fixed cell on desktop) */
      .mk-chart { height: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .mk { animation: none; } }
  `],
})
export class MarketsPageComponent {}
