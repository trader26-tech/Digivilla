import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';

import { BuildingDetail, EstateService, GrowthPt } from '../estate.service';
import { compact } from '../shared/format.util';

/** A resolved point on the chart: date + value (₹) + cumulative rent (₹). */
interface ChartPt { date: string; value: number; rent: number; }

/** Per-fund accent palette, cycled by index. */
const FUND_COLORS = ['#8aa89b', '#f6c445', '#4a9d47', '#5cb85c', '#8fd48a'];

/**
 * The building/villa RETURNS page. Tapping a villa or building tile on the home
 * map opens this. It fetches GET /me/building/{tileId} and shows: the headline
 * value & gain, build progress (for a building), a blended growth chart with a
 * "rent paid out" band, and a per-fund breakdown. Self-contained, animated.
 */
@Component({
  selector: 'app-construction-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './construction-detail.component.html',
  styleUrl: './construction-detail.component.scss',
})
export class ConstructionDetailComponent implements OnInit {
  private estate = inject(EstateService);

  /** The tapped tile's id — the only input; everything else comes from the API. */
  @Input() tileId = '';
  @Output() back = new EventEmitter<void>();

  detail = signal<BuildingDetail | null>(null);
  loading = signal(true);
  error = signal(false);

  compact = compact;
  fundColors = FUND_COLORS;

  ngOnInit(): void {
    if (!this.tileId) { this.loading.set(false); this.error.set(true); return; }
    this.estate.buildingDetail(this.tileId).subscribe({
      next: (d) => { this.detail.set(d); this.loading.set(false); },
      error: () => { this.error.set(true); this.loading.set(false); },
    });
  }

  onBack(): void { this.back.emit(); }

  fundColor(i: number): string { return FUND_COLORS[i % FUND_COLORS.length]; }
  trackFund(i: number, f: { scheme_code: string }): string { return f.scheme_code || String(i); }

  // ── time-range tabs ──────────────────────────────────────────────────────────
  readonly ranges: { key: string; label: string; months: number }[] = [
    { key: '1y', label: '1Y', months: 12 },
    { key: '3y', label: '3Y', months: 36 },
    { key: '5y', label: '5Y', months: 60 },
    { key: 'max', label: 'Max', months: 0 },
  ];
  chartRange = signal<string>('5y');
  setRange(key: string): void { this.chartRange.set(key); this.hoverIdx.set(null); }

  /** The full growth series (value already in ₹). */
  private allPts = computed<ChartPt[]>(() => {
    const g = this.detail()?.growth ?? [];
    return g.map((p: GrowthPt) => ({ date: p.date, value: p.value, rent: p.rent }));
  });

  /** The growth series sliced to the selected time range (from the last date back). */
  windowedGrowth = computed<ChartPt[]>(() => {
    const pts = this.allPts();
    if (!pts.length) return [];
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 0;
    if (!months) return pts;                       // Max — the whole series
    const last = pts[pts.length - 1].date;
    const cut = new Date(last);
    if (isNaN(cut.getTime())) return pts;
    cut.setMonth(cut.getMonth() - months);
    const cutIso = cut.toISOString().slice(0, 10);
    const sliced = pts.filter(p => p.date >= cutIso);
    return sliced.length > 1 ? sliced : pts;       // never show a single point
  });

  // ── SVG geometry (ported from estate-detail) ────────────────────────────────
  readonly chartW = 680;
  readonly chartH = 260;
  readonly padL = 58;
  readonly padR = 10;
  readonly padT = 12;
  readonly padB = 30;

  private get plotW() { return this.chartW - this.padL - this.padR; }
  private get plotH() { return this.chartH - this.padT - this.padB; }

  /** Value bounds of the windowed series — spans both value and rent so the
   *  rent band shares the same scale when it eventually lifts off zero. */
  private vBounds = computed<{ lo: number; hi: number } | null>(() => {
    const w = this.windowedGrowth();
    if (!w.length) return null;
    const vals = w.map(g => g.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo = lo * 0.98; hi = hi * 1.02 || 1; }   // avoid a flat span
    return { lo, hi };
  });

  private xAt(i: number, n: number): number {
    return this.padL + (n <= 1 ? 0 : (i / (n - 1)) * this.plotW);
  }
  private yAt(v: number, lo: number, hi: number): number {
    const span = hi - lo || 1;
    return this.padT + (1 - (v - lo) / span) * this.plotH;
  }

  growthPath = computed<string>(() => {
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (!w.length || !b) return '';
    return w.map((g, i) =>
      `${i === 0 ? 'M' : 'L'}${this.xAt(i, w.length).toFixed(1)} ${this.yAt(g.value, b.lo, b.hi).toFixed(1)}`
    ).join(' ');
  });

  growthArea = computed<string>(() => {
    const line = this.growthPath();
    const w = this.windowedGrowth();
    if (!line || !w.length) return '';
    const baseY = this.chartH - this.padB;
    const lastX = this.xAt(w.length - 1, w.length);
    return `${line} L${lastX.toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  });

  /** A second, faint band: cumulative rent paid out. Flat-zero for now, but
   *  wired so it shows the moment rent > 0. Hidden when the whole band is zero. */
  hasRent = computed<boolean>(() => this.windowedGrowth().some(g => g.rent > 0));

  rentArea = computed<string>(() => {
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (!w.length || !b || !this.hasRent()) return '';
    const baseY = this.chartH - this.padB;
    const line = w.map((g, i) =>
      `${i === 0 ? 'M' : 'L'}${this.xAt(i, w.length).toFixed(1)} ${this.yAt(g.rent, b.lo, b.hi).toFixed(1)}`
    ).join(' ');
    const lastX = this.xAt(w.length - 1, w.length);
    return `${line} L${lastX.toFixed(1)} ${baseY} L${this.padL} ${baseY} Z`;
  });

  /** Y-axis ticks: 4 evenly spaced ₹ amounts across the value range. */
  yTicks = computed<{ y: number; label: string }[]>(() => {
    const b = this.vBounds();
    if (!b) return [];
    const n = 4;
    const out: { y: number; label: string }[] = [];
    for (let i = 0; i <= n; i++) {
      const v = b.lo + (i / n) * (b.hi - b.lo);
      out.push({ y: this.yAt(v, b.lo, b.hi), label: compact(v) });
    }
    return out;
  });

  /** X-axis ticks: ~5 dates. Long ranges show the year; short ranges "Mon 'YY". */
  xTicks = computed<{ x: number; label: string }[]>(() => {
    const w = this.windowedGrowth();
    if (!w.length) return [];
    const n = w.length;
    const months = this.ranges.find(r => r.key === this.chartRange())?.months ?? 60;
    const shortRange = months > 0 && months <= 24;
    const count = Math.min(5, n);
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const idx = count <= 1 ? 0 : Math.round((i / (count - 1)) * (n - 1));
      const d = w[idx].date || '';
      out.push({ x: this.xAt(idx, n), label: shortRange ? this.monLabel(d) : d.slice(0, 4) });
    }
    return out;
  });

  private monLabel(ymd: string): string {
    const [y, mo] = ymd.split('-');
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return mo ? `${MON[+mo] || ''} '${(y || '').slice(2)}` : (y || '');
  }

  // ── Hover ────────────────────────────────────────────────────────────────────
  hoverIdx = signal<number | null>(null);

  onChartMove(ev: MouseEvent): void {
    const svg = ev.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const w = this.windowedGrowth();
    if (!w.length || rect.width === 0) return;
    const xView = ((ev.clientX - rect.left) / rect.width) * this.chartW;
    const frac = Math.max(0, Math.min(1, (xView - this.padL) / this.plotW));
    this.hoverIdx.set(Math.round(frac * (w.length - 1)));
  }
  onChartLeave(): void { this.hoverIdx.set(null); }

  hover = computed(() => {
    const i = this.hoverIdx();
    const w = this.windowedGrowth(); const b = this.vBounds();
    if (i == null || !w.length || !b || !w[i]) return null;
    const g = w[i];
    const x = this.xAt(i, w.length);
    const y = this.yAt(g.value, b.lo, b.hi);
    const base = w[0]?.value ?? g.value;
    const growthPct = base > 0 ? (g.value / base - 1) * 100 : 0;
    return { x, y, value: g.value, date: g.date, rent: g.rent, growthPct };
  });
}
