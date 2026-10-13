import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';

import { AdminService, MarketData, MarketLive } from '../admin.service';
import {
  MONTHS, beta, carry, dailyReturns, fmtNum, iso, lowerBound, mixLabel, niceTicks, replay, sharpe, vol,
} from './replay';

/** Villas vs the market — the admin home's main panel.
 *
 *  Each villa is REPLAYED here, day by day, from the chosen start: ₹100 split by
 *  its calculator-settings weights across the benchmark indices, the growth part
 *  (rebalance.parts) put back to its starting shares at every December close
 *  (= 1 Jan), arbitrage never touched. No tax, no fund costs — like-for-like with
 *  a total-return index. While NSE's board is ahead of the stored closes, today's
 *  live move is added as a provisional last point (equity parts only; gold and
 *  arbitrage hold their last close until the evening files). */

type Period = 'since' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | '10y' | 'max' | 'custom';
type Mode = 'growth' | 'falls';

interface Line {
  key: string; name: string; colour: string; bench: boolean; mix?: string;
  /** level, 100 = start */
  v: number[];
}
interface Stats {
  ret: number; cagr: number | null; vol: number; sharpe: number | null; beta: number | null;
  maxDd: number; ddFrom: string; ddTo: string;
  /** percentage points over the benchmark (null for the benchmark itself) */
  vsBench: number | null;
}

/** Fixed categorical order — the colour follows the villa, never its rank. */
const VILLA_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const BENCH_COLOUR = '#16302B';
const LS_KEY = 'dv_admin_market_view';
const DAY = 86_400_000;

const PERIODS: { key: Period; label: string }[] = [
  { key: '1m', label: '1M' }, { key: '3m', label: '3M' }, { key: '6m', label: '6M' }, { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' }, { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' }, { key: '10y', label: '10Y' },
  { key: 'max', label: 'Max' },
];

@Component({
  selector: 'app-market-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './market-chart.component.html',
  styleUrl: './market-chart.component.scss',
})
export class MarketChartComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(AdminService);
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;
  private poll: any = null;

  readonly periods = PERIODS;
  raw = signal<MarketData | null>(null);
  live = signal<MarketLive | null>(null);
  error = signal<string>('');
  bench = signal<string>('n500');
  period = signal<Period>('since');
  customFrom = signal<string>('');
  customTo = signal<string>('');
  hidden = signal<Set<string>>(new Set());
  focusKey = signal<string | null>(null);
  hover = signal<number | null>(null);
  mode = signal<Mode>('growth');
  table = signal<'stats' | 'years'>('stats');
  benchOpen = signal(false);
  /** phones: the method note opens under the bar (a title tooltip never shows on touch) */
  infoOpen = signal(false);
  width = signal(900);
  boxH = signal(360);

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.bench) this.bench.set(s.bench);
      if (s.period) this.period.set(s.period);
      if (s.from) this.customFrom.set(s.from);
      if (s.to) this.customTo.set(s.to);
    } catch { /* no storage: defaults */ }
    this.load();
    this.loadLive();
  }
  ngAfterViewInit(): void {
    const el = this.host.nativeElement.querySelector('.mc-plot-wrap') as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width) this.width.set(Math.round(r.width));
    if (r.height) this.boxH.set(Math.round(r.height));
    this.ro = new ResizeObserver((es) => {
      const c = es[0]?.contentRect;
      if (!c) return;
      if (c.width > 0 && Math.round(c.width) !== this.width()) this.width.set(Math.round(c.width));
      if (c.height > 0 && Math.round(c.height) !== this.boxH()) this.boxH.set(Math.round(c.height));
    });
    this.ro.observe(el);
  }
  ngOnDestroy(): void { this.ro?.disconnect(); clearTimeout(this.poll); }

  load(): void {
    this.error.set('');
    this.api.marketPerformance().subscribe({
      next: (d) => {
        if (!d.benchmarks.some((b) => b.key === this.bench())) this.bench.set(d.benchmarks[0]?.key || 'n500');
        if (this.period() === 'since' && !d.first_investment) this.period.set('1y');
        this.raw.set(d);
      },
      error: (e) => this.error.set(e?.status === 401 ? 'Session expired — unlock again.' : 'Couldn’t load the market data.'),
    });
  }
  /** NSE's board: every minute while the market is open, every 10 minutes otherwise. */
  private loadLive(): void {
    clearTimeout(this.poll);
    this.api.marketLive().subscribe({
      next: (l) => { this.live.set(l); this.poll = setTimeout(() => this.loadLive(), l.open ? 60_000 : 600_000); },
      error: () => { this.poll = setTimeout(() => this.loadLive(), 120_000); },
    });
  }

  private remember(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        bench: this.bench(), period: this.period(), from: this.customFrom(), to: this.customTo(),
      }));
    } catch { /* ignore */ }
  }

  // ───────────────────────────── controls ─────────────────────────────
  setPeriod(p: Period): void {
    if (p === 'custom' && !this.customFrom()) {
      const r = this.range(), d = this.data();
      if (r && d) { this.customFrom.set(d.days[r.s]); this.customTo.set(d.days[r.e]); }
    }
    this.period.set(p);
    this.hover.set(null);
    this.remember();
  }
  setCustom(which: 'from' | 'to', v: string): void {
    (which === 'from' ? this.customFrom : this.customTo).set(v);
    this.hover.set(null);
    this.remember();
  }
  pickBench(k: string): void {
    this.bench.set(k);
    this.benchOpen.set(false);
    this.remember();
  }
  toggle(key: string): void {
    const h = new Set(this.hidden());
    if (h.has(key)) h.delete(key);
    else if (this.lines().filter((l) => !h.has(l.key)).length > 1) h.add(key);   // never hide the last line
    this.hidden.set(h);
  }
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.benchOpen() && !(e.target as HTMLElement)?.closest?.('.mc-bench')) this.benchOpen.set(false);
  }
  /** Touch: the scrub readout stays after the finger lifts — a tap anywhere else clears it.
   *  (pointerdown, not click: iOS doesn't send clicks on plain elements up to the document.) */
  @HostListener('document:pointerdown', ['$event'])
  onDocPointer(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    if (this.hover() !== null && !t?.closest?.('.mc-hit')) this.hover.set(null);
    if (this.infoOpen() && !t?.closest?.('.mc-info, .mc-note')) this.infoOpen.set(false);
  }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.benchOpen.set(false); this.infoOpen.set(false); }

  // ───────────────────────────── data (+ today's live point) ─────────────────────────────
  /** The stored closes, plus a provisional point for today while NSE's board is ahead of them. */
  data = computed<MarketData | null>(() => {
    const d = this.raw(), l = this.live();
    if (!d || !l?.day || !d.days.length || l.day <= d.days[d.days.length - 1] || !Object.keys(l.quotes).length) return d;
    const series: MarketData['series'] = {};
    for (const [k, s] of Object.entries(d.series)) {
      const last = s.values[s.values.length - 1];
      const q = l.quotes[k];
      series[k] = { ...s, values: [...s.values, last === null ? null : q ? last * (1 + q.pct / 100) : last] };
    }
    return { ...d, days: [...d.days, l.day], series };
  });
  /** true when the last point on the chart is today's live (not yet published) one */
  provisional = computed(() => this.data() !== this.raw());

  benchMeta = computed(() => this.data()?.benchmarks.find((b) => b.key === this.bench()) ?? null);
  sinceLabel = computed(() => {
    const f = this.data()?.first_investment;
    return f ? this.fmtDate(f, true) : '';
  });

  /** Index range [s, e] into data.days for the chosen period. */
  range = computed<{ s: number; e: number } | null>(() => {
    const d = this.data();
    if (!d || d.days.length < 2) return null;
    const days = d.days;
    const e0 = days.length - 1;
    const last = new Date(days[e0] + 'T00:00:00');
    const back = (m: number, y = 0) => { const x = new Date(last); x.setFullYear(x.getFullYear() - y); x.setMonth(x.getMonth() - m); return iso(x); };
    // trailing returns are measured from the last close ON or BEFORE the start date
    const atOrBefore = (t: string) => { let i = lowerBound(days, t); if (i > e0 || days[i] > t) i--; return Math.max(0, i); };
    const atOrAfter = (t: string) => Math.min(e0, lowerBound(days, t));
    let s = 0, e = e0;
    switch (this.period()) {
      case 'since': s = d.first_investment ? atOrAfter(d.first_investment) : 0; break;
      case '1m': s = atOrBefore(back(1)); break;
      case '3m': s = atOrBefore(back(3)); break;
      case '6m': s = atOrBefore(back(6)); break;
      case 'ytd': s = atOrBefore(`${last.getFullYear() - 1}-12-31`); break;
      case '1y': s = atOrBefore(back(0, 1)); break;
      case '3y': s = atOrBefore(back(0, 3)); break;
      case '5y': s = atOrBefore(back(0, 5)); break;
      case '10y': s = atOrBefore(back(0, 10)); break;
      case 'max': s = 0; break;
      case 'custom': {
        if (this.customFrom()) s = atOrAfter(this.customFrom());
        if (this.customTo()) e = atOrBefore(this.customTo());
        break;
      }
    }
    if (e - s < 1) { s = Math.max(0, e - 1); }
    return { s, e };
  });

  dates = computed<string[]>(() => {
    const d = this.data(), r = this.range();
    return d && r ? d.days.slice(r.s, r.e + 1) : [];
  });
  times = computed<number[]>(() => this.dates().map((x) => Date.parse(x + 'T00:00:00Z')));

  /** Every line on the window (villas in settings order, then the benchmark). */
  lines = computed<Line[]>(() => {
    const d = this.data(), r = this.range();
    if (!d || !r) return [];
    const out: Line[] = d.villas.map((v, i) => ({
      key: 'villa:' + v.key, name: v.name, colour: VILLA_COLOURS[i % VILLA_COLOURS.length], bench: false,
      mix: mixLabel(v.weights, d.rebalance?.parts ?? ['gold', 'large', 'mid', 'small']),
      v: replay(d, v.weights, d.rebalance, r.s, r.e),
    }));
    const b = d.series[this.bench()];
    if (b) {
      const vals = carry(b.values.slice(r.s, r.e + 1));
      const b0 = vals[0] || 1;
      out.push({ key: 'bench', name: this.benchMeta()?.label ?? b.name, colour: BENCH_COLOUR, bench: true, v: vals.map((x) => (x / b0) * 100) });
    }
    return out;
  });
  visible = computed(() => this.lines().filter((l) => !this.hidden().has(l.key)));

  stats = computed<Record<string, Stats>>(() => {
    const ls = this.lines(), ds = this.dates(), d = this.data(), r = this.range();
    const out: Record<string, Stats> = {};
    if (!d || !r) return out;
    const benchLine = ls.find((l) => l.bench);
    const benchRet = benchLine ? benchLine.v.at(-1)! / 100 - 1 : null;
    const benchR = benchLine ? dailyReturns(benchLine.v) : [];
    // risk-free = the arbitrage index (cash-like) over the same days
    const rf = d.series['arbitrage'] ? dailyReturns(carry(d.series['arbitrage'].values.slice(r.s, r.e + 1))) : [];
    const years = this.spanYears();
    for (const l of ls) {
      const ret = l.v.at(-1)! / 100 - 1;
      let peak = l.v[0], peakI = 0, maxDd = 0, ddFrom = ds[0], ddTo = ds[0];
      for (let i = 0; i < l.v.length; i++) {
        if (l.v[i] > peak) { peak = l.v[i]; peakI = i; }
        const dd = l.v[i] / peak - 1;
        if (dd < maxDd) { maxDd = dd; ddFrom = ds[peakI]; ddTo = ds[i]; }
      }
      const rr = dailyReturns(l.v);
      out[l.key] = {
        ret, cagr: years >= 1 ? Math.pow(1 + ret, 1 / years) - 1 : null, vol: vol(rr),
        sharpe: sharpe(rr, rf), beta: l.bench ? 1 : beta(rr, benchR), maxDd, ddFrom, ddTo,
        vsBench: l.bench || benchRet === null ? null : (ret - benchRet) * 100,
      };
    }
    return out;
  });
  spanYears = computed(() => {
    const ds = this.dates();
    return ds.length > 1 ? (Date.parse(ds.at(-1)!) - Date.parse(ds[0])) / (365.25 * DAY) : 0;
  });

  // ───────────────────────────── today ─────────────────────────────
  /** The latest day's move for every line — always from the latest two closes,
   *  whatever period is chosen (a villa held for the past year, so its mix has drifted like a real one). */
  today = computed(() => {
    const d = this.data();
    if (!d || d.days.length < 2) return null;
    const e = d.days.length - 1;
    const rows = this.lines().map((l) => {
      let pct: number;
      if (l.bench) {
        const v = d.series[this.bench()]?.values;
        pct = v && v[e] !== null && v[e - 1] ? (v[e]! / v[e - 1]! - 1) : 0;
      } else {
        const w = d.villas.find((x) => 'villa:' + x.key === l.key)!;
        const yr = replay(d, w.weights, d.rebalance, Math.max(0, e - 250), e);
        pct = yr[yr.length - 1] / yr[yr.length - 2] - 1;
      }
      return { key: l.key, name: l.name, colour: l.colour, bench: l.bench, pct };
    });
    const q = this.live()?.quotes?.[this.bench()];
    const day = d.days[e];
    return {
      day, isToday: day === iso(new Date()), rows,
      breadth: q && q.adv !== null && q.dec !== null && this.live()?.day === day ? { adv: q.adv, dec: q.dec } : null,
    };
  });
  todayOf(key: string): number | null { return this.today()?.rows.find((r) => r.key === key)?.pct ?? null; }
  liveLabel = computed(() => {
    const l = this.live(), t = this.today();
    if (l?.open) return { cls: 'open', text: 'Live', sub: l.time ? l.time + ' IST' : '' };
    if (!t) return null;
    return { cls: 'closed', text: 'Market closed', sub: t.isToday ? (l?.time ? l.time : '') : this.fmtDate(t.day, false, true) };
  });

  /** Calendar-year returns inside the window (first/last years may be part-years). */
  yearRows = computed(() => {
    const ds = this.dates(), ls = this.lines();
    if (!ds.length) return [];
    const rows: { year: string; part: boolean; cells: { key: string; ret: number }[]; best: string }[] = [];
    let i0 = 0;
    for (let i = 1; i <= ds.length; i++) {
      if (i === ds.length || ds[i].slice(0, 4) !== ds[i - 1].slice(0, 4)) {
        const y = ds[i - 1].slice(0, 4);
        const startI = i0 === 0 ? 0 : i0 - 1;          // from the previous year's last close
        const part = i0 === 0 && ds[0].slice(5) > '01-07' || (i === ds.length && ds[i - 1].slice(5) < '12-24');
        const cells = ls.map((l) => ({ key: l.key, ret: l.v[i - 1] / l.v[startI] - 1 }));
        const vill = cells.filter((c) => c.key !== 'bench');
        const best = vill.reduce((a, b) => (b.ret > a.ret ? b : a), vill[0])?.key ?? '';
        if (i - 1 > startI) rows.push({ year: y, part, cells, best });
        i0 = i;
      }
    }
    return rows.reverse();
  });

  // ───────────────────────────── geometry ─────────────────────────────
  narrow = computed(() => this.width() < 560);
  margins = computed(() => (this.narrow() ? { t: 12, r: 14, b: 26, l: 44 } : { t: 12, r: 118, b: 26, l: 50 }));
  height = computed(() => Math.max(this.narrow() ? 220 : 240, this.boxH()));
  innerW = computed(() => Math.max(50, this.width() - this.margins().l - this.margins().r));
  innerH = computed(() => this.height() - this.margins().t - this.margins().b);

  /** The plotted value of a level: % change, or % below its running peak. */
  private shown = computed(() => {
    const out: Record<string, number[]> = {};
    for (const l of this.lines()) {
      if (this.mode() === 'growth') out[l.key] = l.v.map((x) => x - 100);
      else { let p = -Infinity; out[l.key] = l.v.map((x) => { p = Math.max(p, x); return (x / p - 1) * 100; }); }
    }
    return out;
  });

  yScale = computed(() => {
    let lo = Infinity, hi = -Infinity;
    for (const l of this.visible()) for (const x of this.shown()[l.key] ?? []) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
    // a tick far below a shallow dip would waste the plot: keep only ticks near the data
    let ticks = niceTicks(lo, hi, this.innerH() < 260 ? 4 : 6);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    ticks = ticks.filter((t) => t >= lo - step * 0.35 && t <= hi + step * 0.35);
    const y0 = Math.min(lo - step * 0.08, ticks[0]), y1 = Math.max(hi + step * 0.04, ticks.at(-1)!);
    const H = this.innerH();
    return { ticks, y: (v: number) => H - ((v - y0) / (y1 - y0)) * H };
  });
  xOf = computed(() => {
    const t = this.times(), W = this.innerW();
    const t0 = t[0] ?? 0, t1 = t.at(-1) ?? 1;
    return (i: number) => (t1 === t0 ? 0 : ((t[i] - t0) / (t1 - t0)) * W);
  });

  paths = computed(() => {
    const x = this.xOf(), y = this.yScale().y, sh = this.shown();
    const n = this.dates().length;
    const step = Math.max(1, Math.floor(n / (this.innerW() * 1.5)));     // ~1.5 points per pixel is plenty
    return this.visible().map((l) => {
      const v = sh[l.key];
      let p = '';
      for (let i = 0; i < n; i += step) p += (p ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v[i]).toFixed(1);
      if ((n - 1) % step) p += 'L' + x(n - 1).toFixed(1) + ',' + y(v[n - 1]).toFixed(1);
      return { key: l.key, colour: l.colour, bench: l.bench, d: p };
    });
  });

  /** A soft wash between the benchmark and the zero line, so "the market" reads as ground. */
  benchArea = computed(() => {
    const b = this.visible().find((l) => l.bench);
    if (!b || this.mode() !== 'growth') return '';
    const x = this.xOf(), y = this.yScale().y, v = this.shown()[b.key], n = v.length;
    const step = Math.max(1, Math.floor(n / (this.innerW() * 1.5)));
    let p = `M${x(0).toFixed(1)},${y(0).toFixed(1)}`;
    for (let i = 0; i < n; i += step) p += `L${x(i).toFixed(1)},${y(v[i]).toFixed(1)}`;
    p += `L${x(n - 1).toFixed(1)},${y(v[n - 1]).toFixed(1)}L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}Z`;
    return p;
  });

  yTicks = computed(() => {
    const { ticks, y } = this.yScale();
    return ticks.map((t) => ({ v: t, y: y(t), label: (t > 0 ? '+' : t < 0 ? '−' : '') + fmtNum(Math.abs(t)) + '%', zero: t === 0 }));
  });

  xTicks = computed(() => {
    const ds = this.dates(), x = this.xOf();
    if (ds.length < 2) return [];
    const spanD = (Date.parse(ds.at(-1)!) - Date.parse(ds[0])) / DAY;
    const maxTicks = Math.max(2, Math.floor(this.innerW() / (this.narrow() ? 70 : 90)));
    const out: { x: number; label: string }[] = [];
    const push = (i: number, label: string) => {
      const px = x(i);
      if (out.length && px - out.at(-1)!.x < (this.narrow() ? 52 : 64)) return;
      out.push({ x: px, label });
    };
    if (spanD <= 75) {
      const every = Math.max(1, Math.ceil(ds.length / maxTicks));
      for (let i = 0; i < ds.length; i += every) push(i, this.fmtDate(ds[i], false));
    } else {
      const monthsSpan = spanD / 30.4;
      const stepM = [1, 2, 3, 6, 12, 24, 36].find((m) => monthsSpan / m <= maxTicks) ?? 60;
      let prev = '';
      for (let i = 1; i < ds.length; i++) {
        const ym = ds[i].slice(0, 7);
        if (ym === prev) continue;
        const pm = ds[i - 1].slice(0, 7);
        prev = ym;
        if (ym === pm) continue;
        const [yy, mm] = ym.split('-').map(Number);
        if (((yy * 12 + mm - 1) % stepM) !== 0) continue;
        push(i, stepM >= 12 ? String(yy) : mm === 1 ? `Jan ’${String(yy).slice(2)}` : MONTHS[mm - 1] + (stepM >= 3 ? ` ’${String(yy).slice(2)}` : ''));
      }
    }
    return out;
  });

  /** Right-hand direct labels, pushed apart so they never collide. */
  endLabels = computed(() => {
    if (this.narrow()) return [];
    const y = this.yScale().y, sh = this.shown(), st = this.stats();
    const ls = this.visible().map((l) => {
      const v = sh[l.key].at(-1)!;
      return { key: l.key, name: l.name, colour: l.colour, bench: l.bench, y0: y(v),
               y: y(v), value: this.mode() === 'growth' ? this.pct(st[l.key].ret) : this.pct(v / 100) };
    }).sort((a, b) => a.y - b.y);
    const gap = 30;
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < gap) ls[i].y = ls[i - 1].y + gap;
    const over = ls.length ? ls.at(-1)!.y - (this.innerH() + 6) : 0;
    if (over > 0) for (const l of ls) l.y -= over;
    for (let i = ls.length - 2; i >= 0; i--) if (ls[i + 1].y - ls[i].y < gap) ls[i].y = ls[i + 1].y - gap;
    return ls;
  });

  // ───────────────────────────── hover ─────────────────────────────
  onMove(ev: PointerEvent): void {
    const svg = (ev.currentTarget as SVGElement).getBoundingClientRect();
    const px = ev.clientX - svg.left - 8;                    // the hit rect starts 8px left of the plot
    const t = this.times();
    if (!t.length) return;
    const W = this.innerW();
    const target = t[0] + (Math.min(Math.max(px, 0), W) / W) * (t.at(-1)! - t[0]);
    let i = lowerBound(t, target);
    if (i >= t.length) i = t.length - 1;
    if (i > 0 && target - t[i - 1] < t[i] - target) i--;
    this.hover.set(i);
  }
  /** a mouse leaving clears the readout; a lifted finger keeps it (see onDocPointer) */
  onLeave(ev: PointerEvent): void { if (ev.pointerType !== 'touch') this.hover.set(null); }
  onKey(ev: KeyboardEvent): void {
    const n = this.dates().length;
    if (!n) return;
    const cur = this.hover() ?? n - 1;
    const jump = ev.shiftKey ? 20 : 1;
    if (ev.key === 'ArrowLeft') { this.hover.set(Math.max(0, cur - jump)); ev.preventDefault(); }
    else if (ev.key === 'ArrowRight') { this.hover.set(Math.min(n - 1, cur + jump)); ev.preventDefault(); }
    else if (ev.key === 'Home') { this.hover.set(0); ev.preventDefault(); }
    else if (ev.key === 'End') { this.hover.set(n - 1); ev.preventDefault(); }
  }

  tip = computed(() => {
    const i = this.hover();
    if (i === null) return null;
    const ds = this.dates(); if (!ds[i]) return null;
    const x = this.xOf()(i), y = this.yScale().y, sh = this.shown();
    const rows = this.visible().map((l) => ({
      key: l.key, name: l.name, colour: l.colour, bench: l.bench,
      value: sh[l.key][i], y: y(sh[l.key][i]), worth: l.v[i],
      day: i > 0 ? l.v[i] / l.v[i - 1] - 1 : null,
    })).sort((a, b) => b.value - a.value);
    const flip = x > this.innerW() * 0.6;
    const live = this.provisional() && i === ds.length - 1;
    return { i, x, date: this.fmtDate(ds[i], true, true), rows, flip, live };
  });

  // ───────────────────────────── formatting ─────────────────────────────
  pct(r: number, dp = 1): string {
    const v = r * 100;
    if (Math.abs(v) < 0.05 && dp <= 1) return '0.0%';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
  }
  pts(p: number | null): string {
    if (p === null) return '—';
    return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1);
  }
  num(v: number | null, dp = 2): string { return v === null ? '—' : (v < 0 ? '−' : '') + Math.abs(v).toFixed(dp); }
  /** What ₹1 lakh became, in lakh. */
  lakh(level: number): string { return '₹' + (level / 100).toFixed(2) + ' L'; }
  fmtDate(s: string, year: boolean, weekday = false): string {
    const d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), ...(weekday ? { weekday: 'short' } : {}) });
  }
  periodLabel = computed(() => {
    const ds = this.dates();
    return ds.length ? `${this.fmtDate(ds[0], true)} – ${this.fmtDate(ds.at(-1)!, true)}` : '';
  });
  minDay = computed(() => this.raw()?.days[0] ?? '');
  maxDay = computed(() => this.data()?.days.at(-1) ?? '');
  methodNote = computed(() =>
    'Villas: each part on its index (Nifty 50 / Midcap 150 / Smallcap 250 TRI, Gold BeES, Nifty 50 Arbitrage), '
    + 'growth part back to equal shares every 1 Jan, arbitrage untouched; before fund costs and tax. '
    + 'Sharpe uses the arbitrage index as the risk-free rate. Beta is against ' + (this.benchMeta()?.label ?? 'the index') + '. '
    + (this.provisional() ? 'Today’s point is live from NSE (equity parts; gold and arbitrage at their last close).' : ''));
}
