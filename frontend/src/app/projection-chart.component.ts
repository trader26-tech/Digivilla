import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';

import { inr } from './format';
import { SimulationBands } from './models';

interface Pt {
  x: number;
  y: number;
}

/**
 * A dependency-free SVG fan chart of the Monte Carlo projection:
 * shaded p10–p90 band, a median (p50) line, and the target line.
 */
@Component({
  selector: 'app-projection-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        preserveAspectRatio="none"
        class="chart"
        role="img"
        aria-label="Projected portfolio value over time"
      >
        <!-- horizontal gridlines -->
        <g class="grid">
          <line
            *ngFor="let g of gridLines"
            [attr.x1]="padL"
            [attr.x2]="W - padR"
            [attr.y1]="g.y"
            [attr.y2]="g.y"
          />
        </g>

        <!-- p10–p90 band -->
        <path [attr.d]="bandPath" class="band" />

        <!-- median line -->
        <path [attr.d]="medianPath" class="median" />

        <!-- target line -->
        <line
          [attr.x1]="padL"
          [attr.x2]="W - padR"
          [attr.y1]="targetY"
          [attr.y2]="targetY"
          class="target"
        />

        <!-- y axis labels -->
        <text
          *ngFor="let g of gridLines"
          [attr.x]="padL - 8"
          [attr.y]="g.y + 4"
          class="ylabel"
        >
          {{ g.label }}
        </text>

        <!-- x axis labels -->
        <text
          *ngFor="let t of xTicks"
          [attr.x]="t.x"
          [attr.y]="H - 6"
          class="xlabel"
        >
          {{ t.label }}
        </text>
      </svg>

      <div class="legend">
        <span class="key"><i class="sw band"></i> Range</span>
        <span class="key"><i class="sw median"></i> Median</span>
        <span class="key"><i class="sw target"></i> Target</span>
      </div>
    </div>
  `,
  styles: [
    `
      .chart-wrap {
        width: 100%;
      }
      .chart {
        width: 100%;
        height: 260px;
        display: block;
      }
      .grid line {
        stroke: color-mix(in srgb, currentColor 10%, transparent);
        stroke-width: 1;
      }
      .band {
        fill: color-mix(in srgb, var(--accent) 22%, transparent);
        stroke: none;
      }
      .median {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2.5;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
      .target {
        stroke: var(--warn);
        stroke-width: 1.5;
        stroke-dasharray: 6 5;
      }
      .ylabel {
        font-size: 11px;
        fill: var(--muted);
        text-anchor: end;
      }
      .xlabel {
        font-size: 11px;
        fill: var(--muted);
        text-anchor: middle;
      }
      .legend {
        display: flex;
        gap: 1.25rem;
        flex-wrap: wrap;
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: var(--muted);
      }
      .key {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .sw {
        width: 16px;
        height: 4px;
        border-radius: 2px;
        display: inline-block;
      }
      .sw.band {
        background: color-mix(in srgb, var(--accent) 35%, transparent);
      }
      .sw.median {
        background: var(--accent);
      }
      .sw.target {
        background: var(--warn);
      }
    `,
  ],
})
export class ProjectionChartComponent implements OnChanges {
  @Input({ required: true }) bands!: SimulationBands;
  @Input({ required: true }) target!: number;
  @Input({ required: true }) years!: number;

  readonly W = 720;
  readonly H = 260;
  readonly padL = 52;
  readonly padR = 16;
  readonly padT = 14;
  readonly padB = 24;

  bandPath = '';
  medianPath = '';
  targetY = 0;
  gridLines: { y: number; label: string }[] = [];
  xTicks: { x: number; label: string }[] = [];

  ngOnChanges(): void {
    if (!this.bands || !this.bands.months?.length) {
      return;
    }
    const months = this.bands.months;
    const n = months.length;
    const maxMonth = months[n - 1];

    const yMax = Math.max(
      Math.max(...this.bands.p90),
      this.target
    ) * 1.08;
    const yMin = 0;

    const plotW = this.W - this.padL - this.padR;
    const plotH = this.H - this.padT - this.padB;

    const xOf = (m: number) => this.padL + (m / maxMonth) * plotW;
    const yOf = (v: number) =>
      this.padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const p10: Pt[] = months.map((m, i) => ({ x: xOf(m), y: yOf(this.bands.p10[i]) }));
    const p90: Pt[] = months.map((m, i) => ({ x: xOf(m), y: yOf(this.bands.p90[i]) }));
    const p50: Pt[] = months.map((m, i) => ({ x: xOf(m), y: yOf(this.bands.p50[i]) }));

    // band = p90 forward + p10 reversed
    const fwd = p90.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const back = [...p10].reverse().map((p) => `L${p.x},${p.y}`).join(' ');
    this.bandPath = `${fwd} ${back} Z`;

    this.medianPath = p50
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
      .join(' ');

    this.targetY = yOf(this.target);

    // gridlines at 0/25/50/75/100% of yMax
    this.gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const val = yMin + f * (yMax - yMin);
      return { y: yOf(val), label: inr(val, val >= 1e7 ? 1 : 0) };
    });

    // x ticks every ~1/5 of the horizon, in years
    const ticks = 5;
    this.xTicks = Array.from({ length: ticks + 1 }, (_, i) => {
      const yr = (this.years * i) / ticks;
      const m = (maxMonth * i) / ticks;
      return { x: xOf(m), label: `${Math.round(yr)}y` };
    });
  }
}
