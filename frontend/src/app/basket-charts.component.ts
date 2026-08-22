import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';

import { inr } from './format';
import { BasketMetrics, GrowthPoint, YearReturn } from './models';

/** Visual evidence for a basket: growth curve, drawdown, yearly-return bars. */
@Component({
  selector: 'app-basket-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './basket-charts.component.html',
  styleUrl: './basket-charts.component.scss',
})
export class BasketChartsComponent implements OnChanges {
  @Input() metrics: BasketMetrics | null = null;
  @Input() color = 'var(--accent)';

  readonly W = 560;
  readonly H = 150;

  growthLine = '';
  growthArea = '';
  ddArea = '';
  worstX: number | null = null;
  worstY = 0;

  // hover
  hover: GrowthPoint | null = null;
  hoverX = 0;
  private gx: number[] = []; // x pixel per growth point

  // projection
  projLine = '';
  projBand = '';

  ngOnChanges(): void {
    this.build();
    this.buildProjection();
  }

  get g(): GrowthPoint[] {
    return this.metrics?.growth ?? [];
  }
  get years(): YearReturn[] {
    return this.metrics?.yearly_returns ?? [];
  }
  get base(): number {
    return this.metrics?.base_investment ?? 10000;
  }
  get finalValue(): number {
    return this.g.length ? this.g[this.g.length - 1].value : 0;
  }

  private build(): void {
    const g = this.g;
    if (g.length < 2) {
      this.growthLine = '';
      return;
    }
    const vals = g.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const stepX = this.W / (g.length - 1);
    const pad = this.H * 0.08;
    const coords = g.map((p, i) => {
      const x = i * stepX;
      const y = pad + (this.H - 2 * pad) * (1 - (p.value - min) / span);
      return [x, y] as const;
    });
    this.gx = coords.map(([x]) => x);
    this.growthLine = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    this.growthArea = `${this.growthLine} L${this.W},${this.H} L0,${this.H} Z`;

    // Drawdown area (0 at top → negative downward).
    const dds = g.map((p) => p.drawdown);
    const worst = Math.min(...dds, -0.001);
    const ddCoords = g.map((p, i) => {
      const x = i * stepX;
      const y = (p.drawdown / worst) * (this.H - 4); // 0 at top, worst near bottom
      return [x, y] as const;
    });
    this.ddArea =
      `M0,0 ` +
      ddCoords.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ` L${this.W},0 Z`;

    // Mark the worst drawdown point.
    const wd = this.metrics?.worst_drawdown_date;
    if (wd) {
      const idx = g.findIndex((p) => p.date === wd);
      if (idx >= 0) {
        this.worstX = idx * stepX;
        this.worstY = (g[idx].drawdown / worst) * (this.H - 4);
      }
    }
  }

  onHover(ev: MouseEvent, el: SVGSVGElement): void {
    const g = this.g;
    if (!g.length || !this.gx.length) return;
    const rect = el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * this.W;
    // nearest point
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.gx.length; i++) {
      const d = Math.abs(this.gx[i] - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.hover = g[best];
    this.hoverX = this.gx[best];
  }
  clearHover(): void {
    this.hover = null;
  }

  private buildProjection(): void {
    const p = this.metrics?.projection;
    if (!p || !p.points.length) {
      this.projLine = '';
      return;
    }
    const w = 560;
    const h = 130;
    const vals = p.points.flatMap((pt) => [pt.p10, pt.p90]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const stepX = w / (p.points.length - 1);
    const y = (v: number) => 6 + (h - 12) * (1 - (v - min) / span);
    const p50 = p.points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(pt.p50).toFixed(1)}`)
      .join(' ');
    const top = p.points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(pt.p90).toFixed(1)}`)
      .join(' ');
    const bottom = p.points
      .slice()
      .reverse()
      .map((pt, i) => {
        const idx = p.points.length - 1 - i;
        return `L${(idx * stepX).toFixed(1)},${y(pt.p10).toFixed(1)}`;
      })
      .join(' ');
    this.projLine = p50;
    this.projBand = `${top} ${bottom} Z`;
  }

  get projection() {
    return this.metrics?.projection ?? null;
  }

  yearBarH(r: number): number {
    const maxAbs = Math.max(...this.years.map((y) => Math.abs(y.ret)), 1);
    return (Math.abs(r) / maxAbs) * 46;
  }

  fmt = inr;
  fmtDate(d: string): string {
    const [y, m] = d.split('-');
    return m ? `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m]} ${y}` : y;
  }
}
