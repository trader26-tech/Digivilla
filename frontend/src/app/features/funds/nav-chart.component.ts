import { CommonModule } from '@angular/common';
import { Component, Input, computed, signal } from '@angular/core';

import { NavPoint } from './fund.models';

/**
 * Lightweight NAV line chart drawn with inline SVG — no charting library, so
 * the bundle stays small and there are no external requests (CSP-friendly).
 */
@Component({
  selector: 'app-nav-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (points().length > 1) {
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        preserveAspectRatio="none"
        class="chart"
        role="img"
        aria-label="NAV history chart"
      >
        <defs>
          <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path [attr.d]="areaPath()" fill="url(#navFill)" />
        <path
          [attr.d]="linePath()"
          fill="none"
          stroke="var(--accent)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="chart-meta">
        <span>Low ₹{{ min().toFixed(2) }}</span>
        <span>High ₹{{ max().toFixed(2) }}</span>
      </div>
    } @else {
      <p class="empty">No history to chart.</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .chart {
        width: 100%;
        height: 260px;
        display: block;
      }
      .chart-meta {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
      }
      .empty {
        color: var(--muted);
        padding: 32px;
        text-align: center;
      }
    `,
  ],
})
export class NavChartComponent {
  readonly W = 800;
  readonly H = 260;

  private readonly _points = signal<NavPoint[]>([]);
  @Input() set data(value: NavPoint[]) {
    this._points.set(value ?? []);
  }
  points = this._points.asReadonly();

  private navs = computed(() => this.points().map((p) => p.nav));
  min = computed(() => Math.min(...this.navs()));
  max = computed(() => Math.max(...this.navs()));

  private coords = computed(() => {
    const pts = this.points();
    const min = this.min();
    const max = this.max();
    const span = max - min || 1;
    const stepX = this.W / (pts.length - 1);
    // Pad vertically so the line isn't flush to edges.
    const pad = this.H * 0.08;
    return pts.map((p, i) => {
      const x = i * stepX;
      const y = pad + (this.H - 2 * pad) * (1 - (p.nav - min) / span);
      return [x, y] as const;
    });
  });

  linePath = computed(() =>
    this.coords()
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' '),
  );

  areaPath = computed(() => {
    const c = this.coords();
    if (!c.length) return '';
    const line = c
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return `${line} L${this.W},${this.H} L0,${this.H} Z`;
  });
}
