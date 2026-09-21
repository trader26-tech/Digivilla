import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';

import { BuildingDetail, BuildingFund, DrainPt, EstateService } from '../estate.service';
import { AmcLogoComponent } from '../shared/amc-logo.component';
import { CountUpDirective } from '../shared/count-up.directive';
import { compact, inr } from '../shared/format.util';

/** The three drained-value windows the backend can return, in tab order. */
type RangeKey = '1y' | '3y' | '5y' | '10y' | '15y';
const RANGE_ORDER: RangeKey[] = ['1y', '3y', '5y', '10y', '15y'];

/** Sleeve tag → colour + label. Same colours as the Home allocation bar
 *  (estate-home SLEEVE_STYLE), so a sleeve looks the same on every screen. */
const TAG_STYLE: Record<string, { colour: string; label: string }> = {
  // ONE family for the growth sleeves (tints of the app's green), a cool grey
  // for the income sleeve, gold ONLY for gold — so the mix bar reads as one
  // system instead of five competing colours.
  ARB:   { colour: '#8a9aa6', label: 'Arbitrage' },
  GOLD:  { colour: '#d9b45a', label: 'Gold' },
  LARGE: { colour: '#5c9b5c', label: 'Large cap' },
  MID:   { colour: '#74b174', label: 'Mid cap' },
  SMALL: { colour: '#93c893', label: 'Small cap' },
  '':    { colour: '#7d8a94', label: 'Other' },
};

/** Acronyms that stay upper-case when an ALL-CAPS scheme name is title-cased. */
const ACRONYMS = new Set(['ICICI', 'SBI', 'HDFC', 'DSP', 'UTI', 'PPFAS', 'ETF', 'FOF', 'IDFC', 'LIC', 'HSBC', 'BNP', 'JM', 'ITI', 'NJ', 'PGIM', 'WOC', 'PSU', 'IT', 'MNC']);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One x-axis label on the drained-value chart. */
interface AxisLabel { x: string; text: string; anchor: 'start' | 'middle' | 'end'; }

/**
 * The drained-value chart, fully resolved from `withdraw.ranges[range]`: the
 * real month-end points on a 320-wide canvas, drawn as a monotone curve (never
 * overshoots a real value) with the "amount put in" as a dashed reference.
 */
interface Chart {
  W: number; H: number; pad: number; base: number;
  n: number;                // points − 1 (the number of monthly steps)
  xs: number[]; ys: number[];
  d: string;                // the value line
  area: string;             // the value line closed down to the baseline
  invY: number;             // y of the dashed "amount put in" line
  col: string;              // green when the end ≥ invested, else red
  up: boolean;
  endValue: number;         // last point's ₹ value
  labels: AxisLabel[];
  withdrawn: number;        // cumulative ₹ withdrawn at the last point
}

/** What the chart header reads out: the end of the range, or the scrubbed month. */
interface Readout { x: number; y: number; value: number; pct: string; up: boolean; label: string; withdrawn: number; scrubbing: boolean; }

/** Monotone cubic through the points (Fritsch–Carlson, harmonic-mean tangents). */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 3) return xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join('');
  const m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 2 * m[i - 1] * m[i] / (m[i - 1] + m[i]);
  let p = 'M' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    p += 'C' + (xs[i] + h).toFixed(1) + ' ' + (ys[i] + t[i] * h).toFixed(1) + ' '
       + (xs[i + 1] - h).toFixed(1) + ' ' + (ys[i + 1] - t[i + 1] * h).toFixed(1) + ' '
       + xs[i + 1].toFixed(1) + ' ' + ys[i + 1].toFixed(1);
  }
  return p;
}

/**
 * The tapped-property "villa report". Opens for ANY non-locked parcel on the
 * home board — a finished villa or any build stage — and renders the reference
 * design/villa-report page bound 100% to GET /me/building/{tileId}:
 *   1. hero: the property's stage art + worth today, invested / held / pays strip
 *   2. pays you (finished villas) or build progress (plots)
 *   3. inside this villa/plot: the mix bar + one tappable card per fund
 *   4. chart: what this mix became while the payout was drained out of it
 *   5. fine print
 */
@Component({
  selector: 'app-construction-detail',
  standalone: true,
  imports: [CommonModule, AmcLogoComponent, CountUpDirective],
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

  /** How long the money has been in: "18 days" / "7 months" / "2.3 years". */
  heldFor(since: string): string {
    const t = Date.parse(since || '');
    if (Number.isNaN(t)) return '—';
    const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
    if (days < 60) return days + (days === 1 ? ' day' : ' days');
    if (days < 365) return Math.floor(days / 30.44) + ' months';
    return (days / 365.25).toFixed(1).replace(/\.0$/, '') + ' years';
  }

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
  /** Every window in tab order — the ones with data plus the ones the mix
   *  can't show honestly (those render disabled, with the reason on tap). */
  allRangeKeys = computed<RangeKey[]>(() => {
    const have = new Set(this.rangeKeys());
    const why = this.detail()?.withdraw?.unavailable ?? {};
    return RANGE_ORDER.filter(k => have.has(k) || !!why[k]);
  });
  rangeWhy(k: RangeKey): string | null { return this.detail()?.withdraw?.unavailable?.[k] ?? null; }
  /** The reason shown under the chart after tapping a disabled window. */
  rangeNote = signal<string | null>(null);
  setRange(k: RangeKey): void {
    const why = this.rangeWhy(k);
    if (why) { this.rangeNote.set(why); return; }
    this.rangeNote.set(null); this.chosenRange.set(k); this.scrubIdx.set(null);
  }
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
    const W = 320, H = 150, pad = 6, padT = 12, base = H - 20;
    const n = pts.length - 1, inv = d.invested;
    const val = pts.map(p => p.value);
    // `inv` joins the pool so the dashed line is always on-canvas.
    let min = Math.min(...val, inv) * .985, max = Math.max(...val, inv) * 1.01;
    if (max - min <= 0) { max = min + 1; }
    const xs = val.map((_, i) => pad + i * (W - 2 * pad) / n);
    const ys = val.map(y => base - (y - min) / (max - min) * (base - padT));
    const dPath = monotonePath(xs, ys);
    const up = Math.round(val[n]) >= inv;
    const step = n <= 12 ? 2 : n <= 36 ? 6 : 12;

    const firstYear = this.yearOf(pts[0].month);
    const labels: AxisLabel[] = [];
    for (let m = 0; m <= n; m += step) {
      const mi = this.monthIdx(pts[m].month), yr = this.yearOf(pts[m].month) - firstYear;
      const text = n <= 12 ? MON[mi] : (yr ? "'" + String(this.yearOf(pts[m].month)).slice(-2) : MON[mi]);
      labels.push({ x: xs[m].toFixed(1), text, anchor: m === 0 ? 'start' : m === n ? 'end' : 'middle' });
    }

    return {
      W, H, pad, base, n, xs, ys, up,
      col: up ? '#8fd48f' : '#e0a0a0',
      d: dPath,
      area: dPath + 'L' + xs[n].toFixed(1) + ' ' + base + 'L' + xs[0].toFixed(1) + ' ' + base + 'Z',
      invY: base - (inv - min) / (max - min) * (base - padT),
      endValue: val[n],
      labels,
      withdrawn: pts[n].withdrawn,
    };
  });

  /** The month under the finger/cursor (index into the range), or null. */
  private scrubIdx = signal<number | null>(null);

  /** The chart header + marker: the scrubbed month while touching, else the end. */
  readout = computed<Readout | null>(() => {
    const c = this.chart(); const d = this.detail(); const pts = this.pts();
    if (!c || !d) return null;
    const s = this.scrubIdx();
    const i = s == null ? c.n : Math.max(0, Math.min(c.n, s));
    const value = pts[i].value, inv = d.invested;
    return {
      x: c.xs[i], y: c.ys[i], value,
      pct: inv > 0 ? this.signedPct((value / inv - 1) * 100, 1) : '0',
      up: Math.round(value) >= inv,
      label: MON[this.monthIdx(pts[i].month)] + ' ' + this.yearOf(pts[i].month),
      withdrawn: pts[i].withdrawn,
      scrubbing: s != null,
    };
  });

  /** Drag/hover across the chart → snap to the nearest month. */
  onScrub(ev: PointerEvent, svg: Element): void {
    const c = this.chart(); if (!c) return;
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const x = (ev.clientX - r.left) / r.width * c.W;
    this.scrubIdx.set(Math.round((x - c.pad) / (c.W - 2 * c.pad) * c.n));
  }
  endScrub(): void { this.scrubIdx.set(null); }

  // ── the confidence note: one true sentence for up, flat or down, from the data ──

  /** Facts pulled from the LONGEST drained-value window the backend returned:
   *  how often the value was above what went in, the worst peak-to-trough dip
   *  and how many months it took to recover, and the total paid out. */
  evidence = computed(() => {
    const d = this.detail(); if (!d) return null;
    const ranges = d.withdraw?.ranges ?? {};
    const key = (['15y', '10y', '5y', '3y', '1y'] as RangeKey[]).find(k => (ranges[k]?.length ?? 0) > 12);
    if (!key) return null;
    const pts = ranges[key] as DrainPt[];
    const inv = d.invested; if (!(inv > 0)) return null;
    const years = { '1y': 1, '3y': 3, '5y': 5, '10y': 10, '15y': 15 }[key];
    const last = pts[pts.length - 1];
    // months the value ITSELF (ignoring what was already paid out) stood above what went in
    let above = 0;
    for (const p of pts) if (p.value >= inv) above++;
    // worst dip from a running peak, and months to climb back to that peak
    let peak = pts[0].value, peakI = 0, worst = 0, worstI = 0, worstPeakI = 0;
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].value;
      if (v > peak) { peak = v; peakI = i; }
      const dd = peak > 0 ? (peak - v) / peak : 0;
      if (dd > worst) { worst = dd; worstI = i; worstPeakI = peakI; }
    }
    let recovered: number | null = null;
    if (worst > 0) {
      const target = pts[worstPeakI].value;
      for (let i = worstI + 1; i < pts.length; i++) if (pts[i].value >= target) { recovered = i - worstI; break; }
    }
    const total = last.value + last.withdrawn;
    return {
      key, years, months: pts.length - 1,
      abovePct: Math.round(above / pts.length * 100),
      worstPct: Math.round(worst * 100), recovered,
      endValue: last.value, paid: last.withdrawn, total,
      growthPct: Math.round((total / inv - 1) * 100),
      multiple: total / inv,
    };
  });

  /** The note's tone follows TODAY's position vs what went in. */
  noteTone = computed<'up' | 'flat' | 'down'>(() => {
    const d = this.detail(); if (!d || !(d.invested > 0)) return 'flat';
    const pct = d.gain / d.invested * 100;
    return pct <= -1 ? 'down' : pct >= 1 ? 'up' : 'flat';
  });

  /** Re-keys the drawn line so it re-draws itself whenever the range changes. */
  drawKeys = computed<string[]>(() => { const r = this.range(); return r ? [r] : []; });

  /** "a year ago" / "3 years ago" — the selected window in words. */
  rangeWords = computed(() => ({ '1y': 'a year ago', '3y': '3 years ago', '5y': '5 years ago', '10y': '10 years ago', '15y': '15 years ago' }[this.range() ?? '1y']));

  private yearOf(ym: string): number { return Number((ym || '').slice(0, 4)) || 0; }
  private monthIdx(ym: string): number { const m = Number((ym || '').slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : 0; }

  // ── funds ───────────────────────────────────────────────────────────────────

  tagColour(tag: string): string { return (TAG_STYLE[tag] ?? TAG_STYLE['']).colour; }
  tagLabel(tag: string): string { return (TAG_STYLE[tag] ?? TAG_STYLE['']).label; }

  /** The fund card that is opened up (one at a time), by scheme code. */
  openFund = signal<string | null>(null);
  toggleFund(f: BuildingFund, i: number): void {
    const k = this.trackFund(i, f);
    this.openFund.set(this.openFund() === k ? null : k);
  }

  /** A trailing return for the opened card: "+12.4%" or "—" while it loads. */
  ret(v: number | null | undefined): string { return v == null ? '—' : this.signedPct(v, 1) + '%'; }

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
