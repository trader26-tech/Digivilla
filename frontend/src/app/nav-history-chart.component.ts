import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';

import { NavHistoryResponse, NavWindow } from './models';

/**
 * NAV history chart with 1Y / 3Y / 5Y / Max window toggles. Inline SVG, no chart
 * library. Shows the selected window's line, total change and CAGR, and high/low.
 */
@Component({
  selector: 'app-nav-history-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './nav-history-chart.component.html',
  styleUrl: './nav-history-chart.component.scss',
})
export class NavHistoryChartComponent implements OnChanges {
  @Input() history: NavHistoryResponse | null = null;
  @Input() color = 'var(--accent)';
  @Input() loading = false;

  readonly W = 640;
  readonly H = 220;

  active = signal<string>('3y');
  linePath = signal<string>('');
  areaPath = signal<string>('');
  hoverX = signal<number | null>(null);

  ngOnChanges(): void {
    if (this.history?.windows?.length) {
      // Default to 3y if present, else the widest available.
      const has3y = this.history.windows.some((w) => w.window === '3y');
      this.active.set(has3y ? '3y' : this.history.windows[this.history.windows.length - 1].window);
      this.compute();
    }
  }

  get windows(): NavWindow[] {
    return this.history?.windows ?? [];
  }
  get current(): NavWindow | null {
    return this.windows.find((w) => w.window === this.active()) ?? null;
  }

  setWindow(w: string): void {
    this.active.set(w);
    this.compute();
  }

  label(w: string): string {
    return { '1y': '1Y', '3y': '3Y', '5y': '5Y', max: 'Max' }[w] ?? w.toUpperCase();
  }

  private compute(): void {
    const win = this.current;
    if (!win || win.points.length < 2) {
      this.linePath.set('');
      this.areaPath.set('');
      return;
    }
    const navs = win.points.map((p) => p.nav);
    const min = Math.min(...navs);
    const max = Math.max(...navs);
    const span = max - min || 1;
    const stepX = this.W / (navs.length - 1);
    const pad = this.H * 0.08;
    const coords = navs.map((nav, i) => {
      const x = i * stepX;
      const y = pad + (this.H - 2 * pad) * (1 - (nav - min) / span);
      return [x, y] as const;
    });
    const line = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    this.linePath.set(line);
    this.areaPath.set(`${line} L${this.W},${this.H} L0,${this.H} Z`);
  }

  changeClass(v: number | null): string {
    if (v === null || v === undefined) return '';
    return v >= 0 ? 'pos' : 'neg';
  }
  fmtPct(v: number | null): string {
    if (v === null || v === undefined) return '—';
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }
}
