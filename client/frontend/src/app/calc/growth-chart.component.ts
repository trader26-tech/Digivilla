import { CommonModule } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, Input, OnDestroy, computed, inject, signal,
} from '@angular/core';

import { compact } from '../shared/format.util';
import { ChartPoint, ChartSeries } from './calc.service';

let uid = 0;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Shared growth chart for the calculators: several ₹ lines over months.
 *
 *   <app-growth-chart [series]="[{label, color, points:[{date:'YYYY-MM', value}], dashed?, area?}]"
 *                     [height]="220" [yFormat]="fn"></app-growth-chart>
 *
 * Lines may span different months; the x-axis is the union. Drawn in real pixels
 * (measured width), so labels never stretch. Touch/drag or hover to scrub.
 */
@Component({
  selector: 'app-growth-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="gc" [style.height.px]="height">
      <svg *ngIf="w() > 0 && geo() as g" [attr.width]="w()" [attr.height]="height"
           (pointermove)="scrub($event)" (pointerdown)="scrub($event)" (pointerleave)="hover.set(-1)"
           role="img" [attr.aria-label]="ariaLabel()">
        <defs>
          <linearGradient *ngFor="let s of g.lines; let i = index" [attr.id]="gid + '-' + i" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" [attr.stop-color]="s.color" stop-opacity="0.28"/>
            <stop offset="100%" [attr.stop-color]="s.color" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <!-- y grid + labels -->
        <g *ngFor="let t of g.ticks">
          <line [attr.x1]="g.left" [attr.x2]="w() - g.right" [attr.y1]="t.y" [attr.y2]="t.y" class="gc-grid"/>
          <text [attr.x]="g.left - 6" [attr.y]="t.y + 3.5" text-anchor="end" class="gc-ytxt">{{ t.label }}</text>
        </g>
        <!-- x labels -->
        <text *ngFor="let x of g.xLabels" [attr.x]="x.x" [attr.y]="height - 6" [attr.text-anchor]="x.anchor" class="gc-xtxt">{{ x.label }}</text>
        <!-- areas then lines -->
        <ng-container *ngFor="let s of g.lines; let i = index">
          <path *ngIf="s.area" [attr.d]="s.areaD" [attr.fill]="'url(#' + gid + '-' + i + ')'"/>
        </ng-container>
        <path *ngFor="let s of g.lines" [attr.d]="s.d" fill="none" [attr.stroke]="s.color" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round" [attr.stroke-dasharray]="s.dashed ? '5 5' : null"/>
        <!-- end dots -->
        <circle *ngFor="let s of g.lines" [attr.cx]="s.endX" [attr.cy]="s.endY" r="3.5" [attr.fill]="s.color"/>
        <!-- scrub -->
        <g *ngIf="hover() >= 0">
          <line [attr.x1]="g.xAt(hover())" [attr.x2]="g.xAt(hover())" [attr.y1]="g.top" [attr.y2]="g.bottom" class="gc-scrub"/>
          <ng-container *ngFor="let s of g.lines">
            <circle *ngIf="s.valAt(hover()) !== null" [attr.cx]="g.xAt(hover())" [attr.cy]="g.yAt(s.valAt(hover())!)"
                    r="4" [attr.fill]="s.color" stroke="var(--paper, #0E1116)" stroke-width="1.5"/>
          </ng-container>
        </g>
      </svg>
    </div>
    <!-- readout (scrub) or legend -->
    <div class="gc-legend">
      <span class="gc-when" *ngIf="hover() >= 0">{{ monthLabel(months()[hover()]) }}</span>
      <span class="gc-item" *ngFor="let s of series">
        <i [style.background]="s.dashed ? 'transparent' : s.color" [style.border-color]="s.color" [class.dash]="s.dashed"></i>
        {{ s.label }}<b *ngIf="hover() >= 0 && valueAt(s, months()[hover()]) as v"> {{ fmt(v) }}</b>
      </span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .gc { position: relative; width: 100%; touch-action: pan-y; }
    svg { display: block; overflow: visible; cursor: crosshair; }
    .gc-grid { stroke: var(--survey, #2A323E); stroke-width: 1; stroke-dasharray: 2 4; }
    .gc-ytxt, .gc-xtxt { fill: var(--muted, #8B95A3); font: 500 10px var(--font-body, Inter, sans-serif); font-variant-numeric: tabular-nums; }
    .gc-scrub { stroke: var(--muted, #8B95A3); stroke-width: 1; opacity: .6; }
    .gc-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 8px; min-height: 18px;
      font-size: 12px; color: var(--muted, #8B95A3); }
    .gc-when { color: var(--ink, #EEF1F5); font-weight: 600; }
    .gc-item { display: inline-flex; align-items: center; gap: 6px; }
    .gc-item b { color: var(--ink, #EEF1F5); font-weight: 600; font-variant-numeric: tabular-nums; }
    .gc-item i { width: 14px; height: 3px; border-radius: 2px; border-top: 0 solid; display: inline-block; }
    .gc-item i.dash { height: 0; border-top: 2px dashed; border-radius: 0; }
  `],
})
export class GrowthChartComponent implements AfterViewInit, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  private readonly _series = signal<ChartSeries[]>([]);
  @Input() set series(v: ChartSeries[] | null | undefined) { this._series.set(v ?? []); }
  get series(): ChartSeries[] { return this._series(); }
  @Input() height = 220;
  @Input() yFormat?: (v: number) => string;

  readonly gid = `gc${++uid}`;
  readonly w = signal(0);
  readonly hover = signal(-1);

  /** Union of every series' months, ascending. */
  readonly months = computed(() => {
    const set = new Set<string>();
    for (const s of this._series()) for (const p of s.points) set.add(p.date);
    return [...set].sort();
  });

  readonly geo = computed(() => {
    const W = this.w(), H = this.height, months = this.months(), lines = this._series();
    if (!W || months.length < 2 || !lines.length) return null;
    const left = 46, right = 10, top = 10, bottom = H - 24;
    const maxV = Math.max(...lines.flatMap((s) => s.points.map((p) => p.value)), 1);
    const step = this.niceStep(maxV / 4);
    const yMax = Math.ceil(maxV / step) * step;
    const n = months.length - 1;
    const xAt = (i: number) => left + (i / n) * (W - left - right);
    const yAt = (v: number) => bottom - (v / yMax) * (bottom - top);
    const pos = new Map(months.map((m, i) => [m, i]));
    const ticks = [];
    for (let v = 0; v <= yMax + 1e-6; v += step) ticks.push({ y: yAt(v), label: v === 0 ? '0' : this.fmt(v) });
    const out = lines.map((s) => {
      const pts = s.points.filter((p) => pos.has(p.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
      const xy = pts.map((p) => [xAt(pos.get(p.date)!), yAt(p.value)]);
      const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
      const byMonth = new Map(pts.map((p) => [p.date, p.value]));
      const last = xy[xy.length - 1] ?? [0, 0];
      return {
        ...s, d,
        areaD: xy.length ? `${d}L${last[0].toFixed(1)},${bottom}L${xy[0][0].toFixed(1)},${bottom}Z` : '',
        endX: last[0], endY: last[1],
        valAt: (i: number) => byMonth.get(months[i]) ?? null,
      };
    });
    const yr = (m: string) => m.slice(0, 4);
    const xLabels = [{ x: xAt(0), label: this.monthLabel(months[0]), anchor: 'start' },
                     { x: xAt(n), label: n > 12 ? yr(months[n]) : this.monthLabel(months[n]), anchor: 'end' }];
    if (n >= 24) xLabels.splice(1, 0, { x: xAt(Math.round(n / 2)), label: yr(months[Math.round(n / 2)]), anchor: 'middle' });
    return { left, right, top, bottom, ticks, lines: out, xLabels, xAt, yAt };
  });

  ngAfterViewInit(): void {
    const el = this.host.nativeElement as HTMLElement;
    const set = () => this.w.set(Math.round(el.getBoundingClientRect().width));
    set();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(set); this.ro.observe(el); }
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }

  scrub(e: PointerEvent): void {
    const g = this.geo();
    if (!g) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const frac = (e.clientX - rect.left - g.left) / (this.w() - g.left - g.right);
    const n = this.months().length - 1;
    this.hover.set(Math.max(0, Math.min(n, Math.round(frac * n))));
  }

  valueAt(s: ChartSeries, month: string): number | null {
    return s.points.find((p) => p.date === month)?.value ?? null;
  }
  fmt(v: number): string { return this.yFormat ? this.yFormat(v) : compact(v); }
  monthLabel(m?: string): string {
    if (!m) return '';
    const [y, mo] = m.split('-').map(Number);
    return `${MON[mo - 1]} ${y}`;
  }
  ariaLabel(): string {
    return this.series.map((s) => `${s.label}: ${this.fmt(s.points[s.points.length - 1]?.value ?? 0)}`).join(', ');
  }
  private niceStep(raw: number): number {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
}
