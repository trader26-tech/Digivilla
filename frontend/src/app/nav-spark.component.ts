import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { NavPoint } from './models';

/** Tiny inline-SVG NAV sparkline / line chart. No chart library. */
@Component({
  selector: 'app-nav-spark',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      *ngIf="points.length > 1"
      [attr.viewBox]="'0 0 ' + w + ' ' + h"
      preserveAspectRatio="none"
      class="spark"
    >
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" [attr.stop-color]="color" stop-opacity="0.25" />
          <stop offset="100%" [attr.stop-color]="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path *ngIf="fill" [attr.d]="areaPath" [attr.fill]="'url(#' + gradId + ')'" />
      <path [attr.d]="linePath" fill="none" [attr.stroke]="color" [attr.stroke-width]="strokeW" vector-effect="non-scaling-stroke" />
    </svg>
  `,
  styles: [`.spark { width: 100%; height: 100%; display: block; }`],
})
export class NavSparkComponent {
  @Input() set data(v: NavPoint[]) {
    this.points = v ?? [];
    this.compute();
  }
  @Input() color = 'var(--accent)';
  @Input() fill = false;
  @Input() strokeW = 1.5;
  @Input() w = 120;
  @Input() h = 36;

  points: NavPoint[] = [];
  linePath = '';
  areaPath = '';
  readonly gradId = 'g' + Math.random().toString(36).slice(2, 8);

  private compute(): void {
    const navs = this.points.map((p) => p.nav);
    if (navs.length < 2) {
      this.linePath = '';
      this.areaPath = '';
      return;
    }
    const min = Math.min(...navs);
    const max = Math.max(...navs);
    const span = max - min || 1;
    const stepX = this.w / (navs.length - 1);
    const pad = this.h * 0.1;
    const coords = navs.map((nav, i) => {
      const x = i * stepX;
      const y = pad + (this.h - 2 * pad) * (1 - (nav - min) / span);
      return [x, y] as const;
    });
    this.linePath = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    this.areaPath = `${this.linePath} L${this.w},${this.h} L0,${this.h} Z`;
  }
}
