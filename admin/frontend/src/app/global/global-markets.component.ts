import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  AdminService, GCountry, GCurrency, GInstrument, GMoves, GPeriod, GQuote, GlobalHistory, GlobalSnapshot,
} from '../admin.service';

/** what every % on the page is measured in */
type Basis = 'local' | 'usd' | 'inr';
type Cls = 'all' | 'DM' | 'EM';
type CView = 'map' | 'table';
type CRange = '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | '10y' | 'max';
type SortKey = 'name' | 'day' | 'fx' | 'period' | GPeriod;

const PERIODS: { k: GPeriod; l: string }[] = [
  { k: '1d', l: '1D' }, { k: '1w', l: '1W' }, { k: '1m', l: '1M' }, { k: '3m', l: '3M' },
  { k: 'ytd', l: 'YTD' }, { k: '1y', l: '1Y' }, { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' },
];
const CRANGES: { k: CRange; l: string }[] = [
  { k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' }, { k: '1y', l: '1Y' },
  { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' }, { k: '10y', l: '10Y' }, { k: 'max', l: 'Max' },
];
/** the heat map's colour reaches full strength at this move (scaled to the period) */
const CAP: Record<GPeriod, number> = { '1d': 2.5, '1w': 5, '1m': 8, '3m': 12, 'ytd': 25, '1y': 30, '3y': 60, '5y': 80 };
const REGIONS = ['Americas', 'Europe', 'Middle East & Africa', 'Asia Pacific'];
/** the validated categorical order — a line keeps its colour for as long as it is on the chart */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_LINES = 8;
const LS = 'dv_admin_global_v1';
const DEFAULT_COMPARE = ['msci_acwi', 'idx:IN', 'idx:US', 'cmd:gold'];
const W = 900, H = 320;
const DAY = 86_400_000;

interface CompareLine { key: string; name: string; colour: string; type: string; d: number[]; v: number[]; }

/**
 * Global markets — one screen for the world's money:
 *  • the MSCI headline indices (ACWI · World · EM · EAFE) and the gauges (US$ index, ₹/US$,
 *    US 10-year, VIX, Brent, gold) — always today's move, plus the chosen period
 *  • all 47 MSCI ACWI countries — a heat map grouped by region, or a sortable table with the
 *    index's own move, its currency's move and the result in US$ or ₹
 *  • a compare chart — any country, MSCI index, commodity or currency, rebased to 0%
 *  • commodities and currencies — every period, in US$ or ₹; currencies vs the US$ or the rupee
 * One toolbar drives the whole page: the PERIOD and the BASIS (own currency · US$ · ₹).
 */
@Component({
  selector: 'app-global-markets',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-markets.component.html',
  styleUrl: './global-markets.component.scss',
})
export class GlobalMarketsComponent implements OnInit, OnDestroy {
  private api = inject(AdminService);
  readonly PERIODS = PERIODS;
  readonly CRANGES = CRANGES;
  readonly REGIONS = REGIONS;
  readonly W = W;
  readonly Math = Math;
  readonly CAP = CAP;
  readonly H = H;

  readonly snap = signal<GlobalSnapshot | null>(null);
  readonly error = signal('');
  readonly loadedAt = signal(0);
  readonly now = signal(Date.now());

  // ── the toolbar ──
  readonly period = signal<GPeriod>('1d');
  readonly basis = signal<Basis>('usd');
  readonly cls = signal<Cls>('all');
  readonly cview = signal<CView>('map');
  readonly sort = signal<{ k: SortKey; dir: 1 | -1 }>({ k: 'period', dir: -1 });
  readonly hoverIso = signal<string | null>(null);
  readonly hoverPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  // ── compare ──
  readonly compare = signal<string[]>(DEFAULT_COMPARE);
  private colourOf = new Map<string, string>();
  readonly crange = signal<CRange>('1y');
  readonly hist = signal<Record<string, GlobalHistory | null>>({});
  readonly histLoading = signal(false);
  readonly pickerOpen = signal(false);
  readonly query = signal('');
  readonly hover = signal<number | null>(null);

  private timer?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (PERIODS.some((p) => p.k === s.period)) this.period.set(s.period);
      if (['local', 'usd', 'inr'].includes(s.basis)) this.basis.set(s.basis);
      if (['all', 'DM', 'EM'].includes(s.cls)) this.cls.set(s.cls);
      if (['map', 'table'].includes(s.cview)) this.cview.set(s.cview);
      if (CRANGES.some((r) => r.k === s.crange)) this.crange.set(s.crange);
      if (Array.isArray(s.compare) && s.compare.length) this.compare.set(s.compare.slice(0, MAX_LINES));
    } catch { /* defaults */ }
    for (const k of this.compare()) this.colourFor(k);
    this.load();
    this.loadHistory();
    this.timer = setInterval(() => this.load(), 90_000);
    this.clock = setInterval(() => this.now.set(Date.now()), 15_000);
  }
  ngOnDestroy(): void { clearInterval(this.timer); clearInterval(this.clock); }

  private remember(): void {
    try {
      localStorage.setItem(LS, JSON.stringify({ period: this.period(), basis: this.basis(), cls: this.cls(), cview: this.cview(), crange: this.crange(), compare: this.compare() }));
    } catch { /* ignore */ }
  }

  load(): void {
    this.api.globalSnapshot().subscribe({
      next: (s) => {
        if (!s.countries.length) { this.error.set('Market data is unavailable right now — trying again shortly.'); return; }
        this.snap.set(s); this.loadedAt.set(Date.now()); this.error.set('');
      },
      error: (e) => this.error.set(e?.status === 401 ? 'Session expired — unlock again.' : 'Market data is unavailable right now — trying again shortly.'),
    });
  }

  // ───────────────────────────── controls ─────────────────────────────
  setPeriod(p: GPeriod): void { this.period.set(p); this.remember(); }
  setBasis(b: Basis): void { this.basis.set(b); this.hover.set(null); this.remember(); }
  setCls(c: Cls): void { this.cls.set(c); this.remember(); }
  setCview(v: CView): void { this.cview.set(v); this.remember(); }
  setCrange(r: CRange): void { this.crange.set(r); this.hover.set(null); this.remember(); }
  sortBy(k: SortKey): void {
    const s = this.sort();
    this.sort.set({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : (k === 'name' ? 1 : -1) });
  }

  // ───────────────────────────── the numbers ─────────────────────────────
  readonly periodLabel = computed(() => PERIODS.find((p) => p.k === this.period())!.l);
  readonly basisLabel = computed(() => ({ local: 'own currency', usd: 'US$', inr: '₹' }[this.basis()]));
  /** an instrument's move for a period in the current basis (commodities / MSCI: local = US$) */
  mv(q: GQuote | null | undefined, p: GPeriod = this.period()): number | null {
    if (!q || !q.ok) return null;
    const b = this.basis();
    const src = b === 'inr' ? q.inr : b === 'local' ? q.local : q.usd;
    return src?.[p] ?? null;
  }
  cmv(c: GCountry, p: GPeriod = this.period()): number | null { return c.perf[this.basis()][p] ?? null; }
  cmvLocal(c: GCountry, p: GPeriod): number | null { return c.perf.local[p] ?? null; }
  /** a currency's move vs the US$ (or vs the rupee in ₹ basis); + = it strengthened */
  fxmv(c: GCurrency, p: GPeriod = this.period()): number | null {
    return (this.basis() === 'inr' ? c.vs_inr : c.vs_usd)[p] ?? null;
  }
  readonly fxBase = computed(() => (this.basis() === 'inr' ? '₹' : 'US$'));

  readonly msci = computed(() => this.snap()?.msci ?? []);
  readonly acwi = computed(() => this.msci().find((m) => m.key === 'msci_acwi') ?? null);
  readonly gauges = computed(() => this.snap()?.gauges ?? []);
  readonly inr = computed(() => this.snap()?.currencies.find((c) => c.ccy === 'INR') ?? null);
  readonly brent = computed(() => this.snap()?.commodities.find((c) => c.key === 'brent') ?? null);
  readonly gold = computed(() => this.snap()?.commodities.find((c) => c.key === 'gold') ?? null);
  gauge(k: string) { return this.gauges().find((g) => g.key === k) ?? null; }

  readonly countries = computed(() => {
    const s = this.snap(); if (!s) return [];
    const c = this.cls();
    return s.countries.filter((x) => c === 'all' || x.cls === c);
  });
  /** the heat map: regions, each country sorted best → worst for the period */
  readonly regions = computed(() => REGIONS.map((r) => {
    const rows = this.countries().filter((c) => c.region === r)
      .sort((a, b) => (this.cmv(b) ?? -1e9) - (this.cmv(a) ?? -1e9));
    const vals = rows.map((c) => this.cmv(c)).filter((v): v is number => v !== null);
    return { name: r, rows, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null, up: vals.filter((v) => v > 0).length, n: vals.length };
  }).filter((r) => r.rows.length));

  /** breadth for the period: up / down, best, worst, equal-weighted DM and EM */
  readonly breadth = computed(() => {
    const all = (this.snap()?.countries ?? []).map((c) => ({ c, v: this.cmv(c) })).filter((x): x is { c: GCountry; v: number } => x.v !== null);
    if (!all.length) return null;
    const sorted = [...all].sort((a, b) => b.v - a.v);
    const avg = (xs: { v: number }[]) => (xs.length ? xs.reduce((s, x) => s + x.v, 0) / xs.length : null);
    return {
      up: all.filter((x) => x.v > 0).length, down: all.filter((x) => x.v < 0).length, n: all.length,
      best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse(),
      dm: avg(all.filter((x) => x.c.cls === 'DM')), em: avg(all.filter((x) => x.c.cls === 'EM')),
    };
  });

  readonly tableRows = computed(() => {
    const { k, dir } = this.sort();
    const val = (c: GCountry): number | string => {
      if (k === 'name') return c.name;
      if (k === 'day') return this.cmvLocal(c, '1d') ?? -1e9;
      if (k === 'fx') return (this.basis() === 'inr' ? this.ccyVsInr(c, this.period()) : c.fx[this.period()]) ?? -1e9;
      if (k === 'period') return this.cmv(c) ?? -1e9;
      return this.cmv(c, k) ?? -1e9;
    };
    return [...this.countries()].sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
  });
  /** a country's currency vs the rupee (+ = it gained on the ₹) */
  ccyVsInr(c: GCountry, p: GPeriod): number | null {
    if (c.ccy === 'INR') return 0;
    const cur = this.snap()?.currencies.find((x) => x.ccy === c.ccy);
    if (c.ccy === 'USD') { const r = this.inr()?.vs_usd[p]; return r == null ? null : (1 / (1 + r / 100) - 1) * 100; }
    return cur?.vs_inr[p] ?? null;
  }
  ccyMove(c: GCountry, p: GPeriod = this.period()): number | null {
    return this.basis() === 'inr' ? this.ccyVsInr(c, p) : c.ccy === 'USD' ? 0 : c.fx[p] ?? null;
  }

  readonly commodityGroups = computed(() => {
    const cs = this.snap()?.commodities ?? [];
    return ['Energy', 'Precious metals', 'Industrial metals', 'Agriculture'].map((g) => ({ name: g, rows: cs.filter((c) => c.group === g) }));
  });
  readonly currencies = computed(() => {
    const cs = [...(this.snap()?.currencies ?? [])];
    const p = this.period();
    return cs.sort((a, b) => (this.fxmv(b, p) ?? -1e9) - (this.fxmv(a, p) ?? -1e9));
  });
  /** the currency bars share one scale: the biggest move this period */
  readonly fxScale = computed(() => Math.max(0.5, ...this.currencies().map((c) => Math.abs(this.fxmv(c) ?? 0))));

  // ───────────────────────────── heat colours ─────────────────────────────
  heat(v: number | null): string {
    if (v === null) return 'var(--surface-2)';
    const t = Math.max(-1, Math.min(1, v / CAP[this.period()]));
    const pct = Math.round(12 + Math.abs(t) * 78);
    return `color-mix(in srgb, ${t >= 0 ? '#2E6B4F' : '#B4402F'} ${pct}%, #F4F0E8)`;
  }
  heatInk(v: number | null): string {
    if (v === null) return 'var(--muted)';
    return Math.abs(v / CAP[this.period()]) > 0.42 ? '#fff' : 'var(--ink)';
  }
  onTileEnter(c: GCountry, ev: MouseEvent): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.hoverPos.set({ x: r.left + r.width / 2, y: r.bottom + 8 });
    this.hoverIso.set(c.iso);
  }
  readonly hoverCountry = computed(() => this.snap()?.countries.find((c) => c.iso === this.hoverIso()) ?? null);

  // ───────────────────────────── formatting ─────────────────────────────
  pct(v: number | null | undefined, dp?: number): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v), d = dp ?? (a >= 100 ? 0 : a >= 10 ? 1 : 2);
    if (a < 0.005 && d >= 2) return '0.00%';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + a.toFixed(d) + '%';
  }
  num(v: number | null | undefined, dp?: number): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const d = dp ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 4);
    return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  /** a commodity's price: US$, or rupees (US$ × ₹ per US$) in the ₹ basis */
  price(c: GQuote): string {
    if (c.last == null) return '—';
    const usdinr = this.inr()?.per_usd;
    if (this.basis() !== 'inr' || !usdinr) return '$' + this.num(c.last);
    const r = c.last * usdinr;
    return '₹' + this.num(r, r >= 100 ? 0 : 2);
  }
  sign(v: number | null | undefined): 'pos' | 'neg' | '' { return v == null ? '' : v > 0.0001 ? 'pos' : v < -0.0001 ? 'neg' : ''; }
  ago = computed(() => {
    const t = this.loadedAt(); if (!t) return '';
    const s = Math.round((this.now() - t) / 1000);
    return s < 30 ? 'just now' : s < 90 ? 'a minute ago' : `${Math.round(s / 60)} min ago`;
  });
  sessionLabel(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  /** "+12.5 bp" for a yield's day move */
  bp(v: number | null | undefined): string { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' bp'; }

  /** a sparkline path (viewBox 100 × 28) */
  spark(vals: number[] | null | undefined): string {
    const v = (vals ?? []).filter((x) => x != null && isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    return v.map((x, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * 100).toFixed(1)} ${(26 - ((x - lo) / span) * 24).toFixed(1)}`).join('');
  }
  sparkUp(vals: number[] | null | undefined): boolean { const v = vals ?? []; return v.length > 1 && v[v.length - 1] >= v[0]; }

  // ───────────────────────────── compare chart ─────────────────────────────
  private colourFor(key: string): string {
    let c = this.colourOf.get(key);
    if (!c) {
      const used = new Set(this.compare().filter((k) => k !== key).map((k) => this.colourOf.get(k)));
      c = SERIES.find((s) => !used.has(s)) ?? SERIES[0];
      this.colourOf.set(key, c);
    }
    return c;
  }
  colour(key: string): string { return this.colourOf.get(key) ?? SERIES[0]; }
  isCompared(key: string): boolean { return this.compare().includes(key); }
  toggleCompare(key: string): void {
    const cur = this.compare();
    if (cur.includes(key)) { if (cur.length > 1) { this.compare.set(cur.filter((k) => k !== key)); this.colourOf.delete(key); } }
    else if (cur.length < MAX_LINES) { this.compare.set([...cur, key]); this.colourFor(key); this.loadHistory(); }
    this.hover.set(null);
    this.remember();
  }
  countryKey(c: GCountry): string { return c.index && c.perf.src['1y'] === 'index' ? 'idx:' + c.iso : c.etf ? 'etf:' + c.iso : 'idx:' + c.iso; }
  addCountry(c: GCountry): void { this.toggleCompare(this.countryKey(c)); }
  readonly full = computed(() => this.compare().length >= MAX_LINES);

  loadHistory(): void {
    const have = this.hist();
    const need = this.compare().filter((k) => !(k in have));
    if (!need.length) return;
    this.histLoading.set(true);
    forkJoin(need.map((k) => this.api.globalHistory(k).pipe(catchError(() => of(null))))).subscribe((res) => {
      const next = { ...this.hist() };
      need.forEach((k, i) => (next[k] = res[i]));
      this.hist.set(next);
      this.histLoading.set(false);
    });
  }

  /** the picker: every instrument, grouped, filtered by the search box */
  readonly pickerGroups = computed(() => {
    const s = this.snap(); if (!s) return [];
    const q = this.query().trim().toLowerCase();
    const country = (iso?: string) => s.countries.find((c) => c.iso === iso);
    const label = (i: GInstrument) => {
      const c = country(i.country);
      if (i.type === 'index' && c) return `${c.flag} ${c.name} — ${i.name}`;
      if (i.type === 'etf' && c) return `${c.flag} ${c.name} — MSCI ETF (US$)`;
      if (i.type === 'fx') return `${s.currencies.find((x) => x.ccy === i.ccy)?.flag ?? ''} ${i.name} (${i.ccy})`;
      return i.name;
    };
    const groups: { name: string; types: string[] }[] = [
      { name: 'MSCI indices', types: ['msci'] }, { name: 'Country indices', types: ['index'] },
      { name: 'MSCI country & region ETFs', types: ['etf'] }, { name: 'Commodities', types: ['commodity'] },
      { name: 'Currencies (value in US$ / ₹)', types: ['fx'] }, { name: 'Gauges', types: ['level'] },
    ];
    return groups.map((g) => ({
      name: g.name,
      items: s.instruments.filter((i) => g.types.includes(i.type))
        .map((i) => ({ key: i.key, label: label(i) }))
        .filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)),
    })).filter((g) => g.items.length);
  });
  @HostListener('document:pointerdown', ['$event'])
  onDoc(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    if (this.pickerOpen() && !t?.closest?.('.gm-pick')) this.pickerOpen.set(false);
    if (this.hover() !== null && !t?.closest?.('.gm-plot')) this.hover.set(null);
  }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.pickerOpen.set(false); this.hoverIso.set(null); }

  nameOf(key: string): string {
    const s = this.snap(); if (!s) return key;
    const i = s.instruments.find((x) => x.key === key); if (!i) return key;
    const c = i.country ? s.countries.find((x) => x.iso === i.country) : null;
    if (c) return i.type === 'etf' ? `${c.name} (MSCI)` : `${c.name} · ${i.name}`;
    if (i.type === 'fx') return `${i.ccy} · ${i.name}`;
    return i.name;
  }
  flagOf(key: string): string {
    const s = this.snap(); const i = s?.instruments.find((x) => x.key === key);
    if (!s || !i) return '';
    if (i.country) return s.countries.find((c) => c.iso === i.country)?.flag ?? '';
    if (i.type === 'fx') return s.currencies.find((c) => c.ccy === i.ccy)?.flag ?? '';
    if (i.type === 'msci') return '🌐';
    if (i.type === 'commodity') return i.group === 'Energy' ? '🛢️' : i.group === 'Agriculture' ? '🌾' : '⛏️';
    return '';
  }

  /** the window [start day, end day] */
  private window = computed(() => {
    const lines = Object.values(this.hist()).filter((h): h is GlobalHistory => !!h && this.compare().includes(h.key));
    const end = Math.max(0, ...lines.map((h) => h.d[h.d.length - 1] ?? 0));
    if (!end) return null;
    const endD = new Date(end * DAY);
    const back = (y: number, m = 0) => { const x = new Date(endD); x.setUTCFullYear(x.getUTCFullYear() - y); x.setUTCMonth(x.getUTCMonth() - m); return Math.floor(x.getTime() / DAY); };
    const first = Math.min(...lines.map((h) => h.d[0]));
    const start = { '1m': back(0, 1), '3m': back(0, 3), '6m': back(0, 6), 'ytd': Math.floor(Date.UTC(endD.getUTCFullYear() - 1, 11, 31) / DAY),
      '1y': back(1), '3y': back(3), '5y': back(5), '10y': back(10), 'max': first }[this.crange()];
    return { start, end };
  });

  /** every compared line in the basis, cut to the window and rebased to 0% at its first close */
  readonly lines = computed<CompareLine[]>(() => {
    const w = this.window(); if (!w) return [];
    const b = this.basis();
    const out: CompareLine[] = [];
    for (const key of this.compare()) {
      const h = this.hist()[key]; if (!h) continue;
      const src = b === 'local' || h.type === 'yield' ? h.v : b === 'inr' ? (h.r ?? h.u) : h.u;
      const d: number[] = [], v: number[] = [];
      for (let i = 0; i < h.d.length; i++) {
        if (h.d[i] < w.start || h.d[i] > w.end) continue;
        const x = src[i];
        if (x != null && x > 0) { d.push(h.d[i]); v.push(x); }
      }
      // the close just before the window opens anchors the start (a 1Y move starts at last year's close)
      let i0 = -1;
      for (let i = 0; i < h.d.length && h.d[i] < w.start; i++) if (src[i] != null && (src[i] as number) > 0) i0 = i;
      if (i0 >= 0 && w.start - h.d[i0] < 10) { d.unshift(h.d[i0]); v.unshift(src[i0] as number); }
      if (v.length < 2) continue;
      const base = v[0];
      out.push({ key, name: this.nameOf(key), colour: this.colour(key), type: h.type, d, v: v.map((x) => (x / base - 1) * 100) });
    }
    return out;
  });
  private span = computed(() => {
    const ls = this.lines(); if (!ls.length) return null;
    const d0 = Math.min(...ls.map((l) => l.d[0])), d1 = Math.max(...ls.map((l) => l.d[l.d.length - 1]));
    let lo = 0, hi = 0;
    for (const l of ls) for (const v of l.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.08 || 1;
    return { d0, d1, lo: lo - pad, hi: hi + pad };
  });
  x(d: number): number { const s = this.span()!; return s.d1 === s.d0 ? 0 : ((d - s.d0) / (s.d1 - s.d0)) * W; }
  y(v: number): number { const s = this.span()!; return H - ((v - s.lo) / (s.hi - s.lo)) * H; }
  readonly paths = computed(() => {
    if (!this.span()) return [];
    return this.lines().map((l) => {
      const step = Math.max(1, Math.floor(l.d.length / 900));
      let p = '';
      for (let i = 0; i < l.d.length; i += step) p += (p ? 'L' : 'M') + this.x(l.d[i]).toFixed(1) + ' ' + this.y(l.v[i]).toFixed(1);
      const n = l.d.length - 1;
      if (n % step) p += 'L' + this.x(l.d[n]).toFixed(1) + ' ' + this.y(l.v[n]).toFixed(1);
      return { key: l.key, colour: l.colour, d: p, fx: l.type === 'fx' };
    });
  });
  readonly yTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const raw = (s.hi - s.lo) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => (s.hi - s.lo) / t <= 6) ?? 10 * mag;
    const out: { v: number; y: number; label: string; zero: boolean }[] = [];
    for (let v = Math.ceil(s.lo / step) * step; v <= s.hi; v += step) {
      const r = +v.toFixed(6);
      out.push({ v: r, y: this.y(r), label: (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%', zero: Math.abs(r) < 1e-9 });
    }
    return out;
  });
  readonly xTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const days = s.d1 - s.d0, out: { x: number; label: string }[] = [];
    const months = days / 30.4;
    const stepM = [1, 2, 3, 6, 12, 24, 36, 60].find((m) => months / m <= 7) ?? 120;
    const d = new Date(s.d0 * DAY); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    while (d.getTime() / DAY <= s.d1) {
      const m = d.getUTCMonth(), yr = d.getUTCFullYear();
      if ((yr * 12 + m) % stepM === 0) {
        out.push({ x: this.x(d.getTime() / DAY), label: stepM >= 12 ? String(yr) : d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (m === 0 || stepM >= 3 ? ` ’${String(yr).slice(2)}` : '') });
      }
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  });
  /** right-hand end labels, pushed apart so they never collide */
  readonly ends = computed(() => {
    if (!this.span()) return [];
    const ls = this.lines().map((l) => ({ key: l.key, colour: l.colour, name: l.name, value: l.v[l.v.length - 1], y0: this.y(l.v[l.v.length - 1]), y: this.y(l.v[l.v.length - 1]) }))
      .sort((a, b) => a.y - b.y);
    const gap = 30;
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < gap) ls[i].y = ls[i - 1].y + gap;
    const over = ls.length ? ls[ls.length - 1].y - H : 0;
    if (over > 0) for (const l of ls) l.y -= over;
    return ls;
  });
  onMove(ev: PointerEvent, el: Element): void {
    const s = this.span(); if (!s) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    this.hover.set(Math.round(s.d0 + f * (s.d1 - s.d0)));
  }
  readonly tip = computed(() => {
    const day = this.hover(); if (day === null || !this.span()) return null;
    const rows = this.lines().map((l) => {
      let i = -1; for (let k = 0; k < l.d.length && l.d[k] <= day; k++) i = k;
      return i < 0 ? null : { key: l.key, name: l.name, colour: l.colour, value: l.v[i], y: this.y(l.v[i]) };
    }).filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.value - a.value);
    const x = this.x(day);
    return { x, flip: x > W * 0.62, date: new Date(day * DAY).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), rows };
  });
  /** the table under the chart: return, a year (≥ 1 year), volatility, worst fall, in the window */
  readonly stats = computed(() => this.lines().map((l) => {
    const lv = l.v.map((v) => 1 + v / 100);
    const yrs = (l.d[l.d.length - 1] - l.d[0]) / 365.25;
    const ret = lv[lv.length - 1] - 1;
    const rs: number[] = [];
    for (let i = 1; i < lv.length; i++) rs.push(lv[i] / lv[i - 1] - 1);
    const m = rs.reduce((s, r) => s + r, 0) / (rs.length || 1);
    const sd = Math.sqrt(rs.reduce((s, r) => s + (r - m) ** 2, 0) / Math.max(1, rs.length - 1));
    let pk = lv[0], dd = 0;
    for (const v of lv) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); }
    return { key: l.key, name: l.name, colour: l.colour, ret: ret * 100, cagr: yrs >= 1 ? (Math.pow(1 + ret, 1 / yrs) - 1) * 100 : null, vol: sd * Math.sqrt(252) * 100, dd: dd * 100 };
  }).sort((a, b) => b.ret - a.ret));
  readonly missing = computed(() => this.compare().filter((k) => this.hist()[k] === null).map((k) => this.nameOf(k)));
  readonly crangeLabel = computed(() => {
    const s = this.span(); if (!s) return '';
    const f = (d: number) => new Date(d * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${f(s.d0)} – ${f(s.d1)}`;
  });
  trackKey(_: number, x: { key: string }): string { return x.key; }
  trackIso(_: number, x: { iso: string }): string { return x.iso; }
}
