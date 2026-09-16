import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';

import { BuildingDetail, DrainPt, EstateService } from '../estate.service';
import { compact, inr } from '../shared/format.util';

/** The three drained-value windows the backend can return, in tab order. */
type RangeKey = '1y' | '3y' | '5y';
const RANGE_ORDER: RangeKey[] = ['1y', '3y', '5y'];

/** Sleeve tag → chip colour (from design/villa-report). '' = an untagged fund. */
const TAG_COLOUR: Record<string, string> = {
  ARB: '#8fb7b0', SMALL: '#58b858', MID: '#6ac86a', GOLD: '#e9c15c', LARGE: '#9184d9', '': '#9a9aa5',
};

/** Acronyms that stay upper-case when an ALL-CAPS scheme name is title-cased. */
const ACRONYMS = new Set(['ICICI', 'SBI', 'HDFC', 'DSP', 'UTI', 'PPFAS', 'ETF', 'FOF', 'IDFC', 'LIC', 'HSBC', 'BNP', 'JM', 'ITI', 'NJ', 'PGIM', 'WOC', 'PSU', 'IT', 'MNC']);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One x-axis label on the drained-value chart. */
interface AxisLabel { x: string; text: string; anchor: 'start' | 'middle' | 'end'; }
/** One gold withdrawal dot on the drained-value chart. */
interface Dot { cx: string; cy: string; }

/**
 * The drained-value chart, fully resolved from `withdraw.ranges[range]` — a
 * straight port of the reference `vrMain()` geometry (W 320 · H 120 · pad 8 ·
 * padB 18) with the seeded series replaced by the real month-end points.
 */
interface Chart {
  W: number; H: number; pad: number; padB: number;
  n: number;                // points − 1 (the number of monthly steps)
  d: string;                // the value line
  area: string;             // the value line closed down to the baseline
  invY: string;             // y of the dashed "amount put in" line
  col: string;              // green when the end ≥ invested, else red
  up: boolean;
  endValue: number;         // last point's ₹ value
  endPct: string;           // signed % vs invested, 0 decimals
  dots: Dot[];              // one per withdrawal (empty while building)
  labels: AxisLabel[];
  withdrawn: number;        // cumulative ₹ withdrawn at the last point
  dotR: number;
}

/**
 * The tapped-property "villa report". Opens for ANY non-locked parcel on the
 * home board — a finished villa or any build stage — and renders the reference
 * design/villa-report page bound 100% to GET /me/building/{tileId}:
 *   1. header: the property's stage art + invested → worth today
 *   2. chart: what this mix became while the payout was drained out of it
 *   3. pays you (finished villas only)
 *   4. inside this villa/plot: one card per fund
 *   5. fine print
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

  /** The tapped tile's id — everything on the page comes from its API detail. */
  @Input() tileId = '';
  /** The board label (Villa 03 / Plot 06). The backend `name` is a generic "Villa". */
  @Input() title = '';
  @Output() back = new EventEmitter<void>();

  detail = signal<BuildingDetail | null>(null);
  loading = signal(true);
  error = signal(false);
  /** The chart/returns are still streaming in after the fast first paint. */
  chartLoading = signal(false);

  inr = inr;
  compact = compact;

  ngOnInit(): void {
    if (!this.tileId) { this.loading.set(false); this.error.set(true); return; }
    // Phase 1 — FAST paint: headline + funds from cached NAVs, no history fetch.
    this.estate.buildingDetail(this.tileId, true).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
        if (d.has_chart === false) this.loadChart();   // phase 2
      },
      // fall back to the one-shot full fetch if the fast path fails
      error: () => this.estate.buildingDetail(this.tileId).subscribe({
        next: (d) => { this.detail.set(d); this.loading.set(false); },
        error: () => { this.error.set(true); this.loading.set(false); },
      }),
    });
  }

  /** Phase 2 — merge the history-derived chart + returns into the shown detail. */
  private loadChart(): void {
    this.chartLoading.set(true);
    this.estate.buildingChart(this.tileId).subscribe({
      next: (c) => {
        const d = this.detail();
        if (d) {
          const funds = d.funds.map((f) => {
            const r = c.fund_returns[String(f.scheme_code)];
            return r ? { ...f, ret_1y: r.ret_1y, ret_3y: r.ret_3y, ret_5y: r.ret_5y } : f;
          });
          this.detail.set({ ...d, funds, overall: c.overall,
            withdraw: c.withdraw, growth: c.growth, has_chart: true });
        }
        this.chartLoading.set(false);
      },
      error: () => this.chartLoading.set(false),
    });
  }

  onBack(): void { this.back.emit(); }

  trackFund(i: number, f: { scheme_code: string }): string { return f.scheme_code || String(i); }
  trackKey(_: number, k: string): string { return k; }

  // ── header ──────────────────────────────────────────────────────────────────

  /** Tile-art symbol for the property's build stage (0 ground … 5 villa). */
  artHref(d: BuildingDetail): string {
    if (d.status === 'constructed') return '#tVilla';
    const map = ['#tGround', '#tLand', '#tGrade', '#tFound', '#tSteel', '#tVilla'];
    const s = Math.max(0, Math.min(5, Math.floor(Number(d.stage) || 0)));
    return map[s];
  }

  /** The art to show WHILE loading — inferred from the tapped label so the loader
   *  already matches the property (a "Villa" shows the villa, a "Plot" the land). */
  get loadArtHref(): string {
    return /villa/i.test(this.title) ? '#tVilla' : /plot|tile/i.test(this.title) ? '#tLand' : '#tVilla';
  }

  isUp(v: number): boolean { return v >= 0; }
  dir(v: number): string { return v >= 0 ? 'vr-up' : 'vr-dn'; }
  arrow(v: number): string { return v >= 0 ? '▲' : '▼'; }

  /** Signed percentage: "+2.5" / "-0.9"; a value that rounds to zero is "0.0", never "-0.0". */
  signedPct(v: number, decimals = 1): string {
    const abs = Math.abs(v || 0).toFixed(decimals);
    if (Number(abs) === 0) return abs;
    return (v > 0 ? '+' : '-') + abs;
  }

  /** "+₹8,243" / "−₹2" — the movement in rupees, with the typographic minus. */
  signedInr(v: number): string { return (v >= 0 ? '+' : '−') + inr(Math.abs(v)); }

  // ── chart ───────────────────────────────────────────────────────────────────

  /** Range tabs: only the keys the backend actually returned, in 1y/3y/5y order. */
  rangeKeys = computed<RangeKey[]>(() => {
    const ranges = this.detail()?.withdraw?.ranges ?? {};
    return RANGE_ORDER.filter(k => Array.isArray(ranges[k]) && (ranges[k] as DrainPt[]).length > 0);
  });

  private chosenRange = signal<RangeKey | null>(null);
  /** The selected range: the user's pick, else '1y' when present, else the first available. */
  range = computed<RangeKey | null>(() => {
    const keys = this.rangeKeys();
    const pick = this.chosenRange();
    if (pick && keys.includes(pick)) return pick;
    return keys.includes('1y') ? '1y' : (keys[0] ?? null);
  });
  setRange(k: RangeKey): void { this.chosenRange.set(k); }
  rangeLabel(k: RangeKey): string { return k.toUpperCase(); }

  /** The points behind the selected range. */
  private pts = computed<DrainPt[]>(() => {
    const r = this.range(); const d = this.detail();
    if (!r || !d) return [];
    return d.withdraw.ranges[r] ?? [];
  });

  chart = computed<Chart | null>(() => {
    const d = this.detail(); const pts = this.pts();
    if (!d || pts.length < 2) return null;
    const W = 320, H = 120, pad = 8, padB = 18;
    const n = pts.length - 1, inv = d.invested;
    const val = pts.map(p => p.value);
    // vrMain: min ×.985 / max ×1.01 — `inv` joins the pool so the dashed line is always on-canvas.
    let min = Math.min(...val, inv) * .985, max = Math.max(...val, inv) * 1.01;
    if (max - min <= 0) { max = min + 1; }
    const X = (i: number) => pad + i * (W - 2 * pad) / n;
    const Y = (y: number) => H - padB - (y - min) / (max - min) * (H - padB - pad);
    const dPath = val.map((y, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(y).toFixed(1)).join('');
    const end = Math.round(val[n]), up = end >= inv, col = up ? '#8fd48f' : '#e0a0a0';
    const step = n <= 12 ? 1 : n <= 36 ? 6 : 12;

    const dots: Dot[] = [];
    if (d.withdraw.monthly > 0) {
      for (let k = 1; k <= n; k++) dots.push({ cx: X(k).toFixed(1), cy: Y(val[k]).toFixed(1) });
    }

    const firstYear = this.yearOf(pts[0].month);
    const labels: AxisLabel[] = [];
    for (let m = 0; m <= n; m += step) {
      const mi = this.monthIdx(pts[m].month), yr = this.yearOf(pts[m].month) - firstYear;
      const text = n <= 12 ? MON[mi] : (yr ? "'" + String(this.yearOf(pts[m].month)).slice(-2) : MON[mi]);
      labels.push({ x: X(m).toFixed(1), text, anchor: m === 0 ? 'start' : m === n ? 'end' : 'middle' });
    }

    return {
      W, H, pad, padB, n, col, up,
      d: dPath,
      area: dPath + ' L' + X(n).toFixed(1) + ' ' + (H - padB) + ' L' + pad + ' ' + (H - padB) + ' Z',
      invY: Y(inv).toFixed(1),
      endValue: val[n],
      endPct: inv > 0 ? this.signedPct((end / inv - 1) * 100, 0) : '0',
      dots, labels,
      withdrawn: pts[n].withdrawn,
      dotR: n <= 12 ? 3.2 : 1.8,
    };
  });

  private yearOf(ym: string): number { return Number((ym || '').slice(0, 4)) || 0; }
  private monthIdx(ym: string): number { const m = Number((ym || '').slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : 0; }

  // ── funds ───────────────────────────────────────────────────────────────────

  tagColour(tag: string): string { return TAG_COLOUR[tag] ?? TAG_COLOUR['']; }

  /** The fund's role in this mix, by sleeve tag. */
  role(tag: string, d: BuildingDetail): string {
    switch (tag) {
      case 'ARB': return d.status === 'constructed' ? `Fuels your ${inr(d.payout.monthly)} a month` : 'Will fuel your payout';
      case 'SMALL': return 'Growth · small cap';
      case 'MID': return 'Growth · mid cap';
      case 'LARGE': return 'Growth · large cap';
      case 'GOLD': return 'Cushion · gold';
      default: return 'Part of the mix';
    }
  }

  /** "Kotak Arbitrage Fund Growth" → "Kotak Arbitrage"; strips plan/option/vehicle noise. */
  shortName(name: string): string {
    let s = (name || '').trim();
    s = s.replace(/\s*[-–]\s*(direct|regular)\s*plan\b.*$/i, '')
         .replace(/\s*\((direct|regular)\s*plan\)/ig, '')
         .replace(/\s*\b(direct|regular)\s*plan\b/ig, '')
         .replace(/\s*[-–]\s*growth(\s*option)?\b.*$/i, '')
         .replace(/\s*\(g(rowth)?\)\s*$/i, '')
         .replace(/\s+growth(\s*option)?\s*$/i, '')
         .replace(/\s+etf\s+fof\s*$/i, '')
         .replace(/\s+fund\s+of\s+funds?\s*$/i, '')
         .replace(/\s+fund\s*$/i, '')
         .replace(/\s*[-–]\s*$/, '')
         .trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) {
      s = s.split(/\s+/).map(w => ACRONYMS.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    }
    return s || name;
  }

  /** Per-fund move as % of what went in. */
  fundPct(f: { gain: number; invested: number }): number {
    return f.invested > 0 ? (f.gain / f.invested) * 100 : 0;
  }
  /** Movement bar: invested share of the larger of invested/now. */
  invWidth(f: { invested: number; current_value: number }): string {
    const m = Math.max(f.invested, f.current_value) || 1;
    return Math.min(100, 100 * f.invested / m).toFixed(1);
  }
  /** Movement bar: the gain/loss segment's share. */
  gainWidth(f: { invested: number; current_value: number; gain: number }): string {
    const m = Math.max(f.invested, f.current_value) || 1;
    return Math.min(100, 100 * Math.abs(f.gain) / m).toFixed(1);
  }
}
