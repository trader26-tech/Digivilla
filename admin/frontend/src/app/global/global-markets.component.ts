import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  AdminService, GCommodity, GCountry, GCurrency, GInstrument, GMoves, GPeriod, GQuote, GlobalHistory, GlobalSnapshot,
} from '../admin.service';

/** what every % on the page is measured in */
type Basis = 'local' | 'usd' | 'inr';
type Cls = 'all' | 'DM' | 'EM';
type CView = 'map' | 'matrix';
type CRange = '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | '10y' | 'max';
type Kind = 'equity' | 'commodity' | 'fx';

const PERIODS: { k: GPeriod; l: string }[] = [
  { k: '1d', l: '1D' }, { k: '1w', l: '1W' }, { k: '1m', l: '1M' }, { k: '3m', l: '3M' },
  { k: 'ytd', l: 'YTD' }, { k: '1y', l: '1Y' }, { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' },
];
const CRANGES: { k: CRange; l: string }[] = [
  { k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' }, { k: '1y', l: '1Y' },
  { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' }, { k: '10y', l: '10Y' }, { k: 'max', l: 'Max' },
];
/** a heat colour reaches full strength at this move — per asset kind, scaled to the period */
const CAPS: Record<Kind, Record<GPeriod, number>> = {
  equity: { '1d': 2.5, '1w': 5, '1m': 8, '3m': 12, 'ytd': 25, '1y': 30, '3y': 60, '5y': 80 },
  commodity: { '1d': 3, '1w': 6, '1m': 10, '3m': 15, 'ytd': 30, '1y': 35, '3y': 60, '5y': 80 },
  fx: { '1d': 0.8, '1w': 1.5, '1m': 3, '3m': 5, 'ytd': 8, '1y': 10, '3y': 20, '5y': 30 },
};
const REGIONS = ['Americas', 'Europe', 'Middle East & Africa', 'Asia Pacific'];
/** the validated categorical order — a line keeps its colour for as long as it is on the chart */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const MAX_LINES = 8;
/** names that fit a heat cell */
const SHORT: Record<string, string> = {
  US: 'USA', GB: 'UK', KR: 'S. Korea', SA: 'Saudi Arabia', ZA: 'S. Africa', NZ: 'N. Zealand', CZ: 'Czechia', AE: 'UAE',
  NL: 'Netherlands', PH: 'Philippines',
};
const CSHORT: Record<string, string> = {
  brent: 'Brent', wti: 'WTI', natgas: 'Nat. gas', gasoline: 'Gasoline', heatoil: 'Heating oil', cattle: 'Cattle',
};
const LS = 'dv_admin_global_v2';
const DEFAULT_COMPARE = ['msci_acwi', 'idx:US', 'idx:IN', 'idx:JP', 'idx:CN', 'cmd:gold'];
const DAY = 86_400_000;
const PAD = { l: 46, r: 132, t: 10, b: 22 };

interface CompareLine { key: string; name: string; colour: string; type: string; d: number[]; v: number[]; }
/** one heat cell anywhere on the page */
interface Cell { key: string; name: string; sub: string; flag: string; v: number | null; kind: Kind; tag?: string; note?: string; }
interface Hover { x: number; y: number; title: string; sub: string; level: string; rows: { label: string; v: number | null; kind: Kind }[]; note?: string; }

/**
 * Global markets — the whole world on ONE screen (no scrolling on a laptop):
 *   top     a heat strip of the MSCI indices and the gauges (₹/US$, US$ index, Brent, gold, VIX, US 10-year)
 *   left    the 47 MSCI ACWI countries — a heat map by region, or a country × period heat matrix
 *   right   a line chart comparing anything (US$ by default) and heat maps of commodities and currencies
 * One toolbar drives everything: the PERIOD and the BASIS (own currency · US$ · ₹). Every heat cell
 * prints its signed % (colour is never the only cue), hovers to a card with all eight periods, and
 * clicks onto the line chart.
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
  private ro?: ResizeObserver;
  readonly PERIODS = PERIODS;
  readonly CRANGES = CRANGES;
  readonly CAPS = CAPS;
  readonly PAD = PAD;
  short(c: GCountry): string { return SHORT[c.iso] ?? c.name; }
  cshort(c: GCommodity): string { return CSHORT[c.key] ?? c.name; }

  readonly snap = signal<GlobalSnapshot | null>(null);
  readonly error = signal('');
  readonly loadedAt = signal(0);
  readonly now = signal(Date.now());

  readonly period = signal<GPeriod>('1d');
  readonly basis = signal<Basis>('usd');
  readonly cls = signal<Cls>('all');
  readonly cview = signal<CView>('map');
  readonly tip = signal<Hover | null>(null);

  readonly compare = signal<string[]>(DEFAULT_COMPARE);
  private colourOf = new Map<string, string>();
  readonly crange = signal<CRange>('1y');
  readonly hist = signal<Record<string, GlobalHistory | null>>({});
  readonly histLoading = signal(false);
  readonly pickerOpen = signal(false);
  readonly query = signal('');
  readonly hover = signal<number | null>(null);
  /** the line chart's drawing size = its box, measured */
  readonly box = signal({ w: 640, h: 300 });

  private timer?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (PERIODS.some((p) => p.k === s.period)) this.period.set(s.period);
      if (['local', 'usd', 'inr'].includes(s.basis)) this.basis.set(s.basis);
      if (['all', 'DM', 'EM'].includes(s.cls)) this.cls.set(s.cls);
      if (['map', 'matrix'].includes(s.cview)) this.cview.set(s.cview);
      if (CRANGES.some((r) => r.k === s.crange)) this.crange.set(s.crange);
      if (Array.isArray(s.compare) && s.compare.length) this.compare.set(s.compare.slice(0, MAX_LINES));
    } catch { /* defaults */ }
    for (const k of this.compare()) this.colourFor(k);
    this.load();
    this.loadHistory();
    this.timer = setInterval(() => this.load(), 90_000);
    this.clock = setInterval(() => this.now.set(Date.now()), 15_000);
  }
  /** the plot only exists once data has arrived: observe its size whenever it (re)appears */
  @ViewChild('plotEl') set plotEl(ref: ElementRef<HTMLElement> | undefined) {
    this.ro?.disconnect();
    const el = ref?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver((es) => {
      const c = es[0]?.contentRect;
      if (!c?.width || !c.height) return;
      const w = Math.round(c.width), h = Math.round(c.height), cur = this.box();
      if (w !== cur.w || h !== cur.h) this.box.set({ w, h });
    });
    this.ro.observe(el);
  }
  ngOnDestroy(): void { clearInterval(this.timer); clearInterval(this.clock); this.ro?.disconnect(); }

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

  // ───────────────────────────── the numbers ─────────────────────────────
  readonly periodLabel = computed(() => PERIODS.find((p) => p.k === this.period())!.l);
  readonly basisLabel = computed(() => ({ local: 'own currency', usd: 'US$', inr: '₹' }[this.basis()]));
  readonly fxBase = computed(() => (this.basis() === 'inr' ? '₹' : 'US$'));
  mv(q: GQuote | null | undefined, p: GPeriod = this.period()): number | null {
    if (!q || !q.ok) return null;
    const b = this.basis();
    const src = b === 'inr' ? q.inr : b === 'local' ? q.local : q.usd;
    return src?.[p] ?? null;
  }
  cmv(c: GCountry, p: GPeriod = this.period()): number | null { return c.perf[this.basis()][p] ?? null; }
  fxmv(c: GCurrency, p: GPeriod = this.period()): number | null { return (this.basis() === 'inr' ? c.vs_inr : c.vs_usd)[p] ?? null; }

  readonly acwi = computed(() => this.snap()?.msci.find((m) => m.key === 'msci_acwi') ?? null);
  readonly inr = computed(() => this.snap()?.currencies.find((c) => c.ccy === 'INR') ?? null);
  private gauge(k: string) { return this.snap()?.gauges.find((g) => g.key === k) ?? null; }
  private commodity(k: string) { return this.snap()?.commodities.find((c) => c.key === k) ?? null; }

  /** the top strip: MSCI headline indices + the gauges, each a heat cell for the period */
  readonly strip = computed(() => {
    const s = this.snap(); if (!s) return [];
    const p = this.period();
    const out: (Cell & { level: string; d1: number | null; unit?: string; bp?: string })[] = [];
    for (const m of s.msci) {
      out.push({ key: m.key, name: m.name.replace('Emerging Markets', 'EM'), sub: m.about, flag: '🌐', v: this.mv(m), kind: 'equity',
                 level: this.num(m.last, 0), d1: this.mv(m, '1d'), note: m.src[p] === 'etf' ? `via ${m.etf}` : undefined });
    }
    const r = this.inr();
    if (r) {
      const v = r.vs_usd[p], d1 = r.vs_usd['1d'];
      out.push({ key: 'fx:INR', name: 'Rupee vs US$', sub: '₹ per US$ — the % is the rupee’s move', flag: '🇮🇳', v, kind: 'fx', level: '₹' + this.num(r.per_usd, 2), d1 });
    }
    const dxy = this.gauge('dxy');
    if (dxy) out.push({ key: 'dxy', name: 'US$ index', sub: dxy.about, flag: '💵', v: dxy.local?.[p] ?? null, kind: 'fx', level: this.num(dxy.last, 1), d1: dxy.local?.['1d'] ?? null });
    for (const k of ['brent', 'gold']) {
      const c = this.commodity(k);
      if (c) out.push({ key: 'cmd:' + k, name: c.name, sub: 'US$' + c.unit, flag: k === 'gold' ? '🥇' : '🛢️', v: this.mv(c), kind: 'commodity', level: this.price(c), d1: this.mv(c, '1d') });
    }
    const y = this.gauge('us10y');
    if (y) out.push({ key: 'us10y', name: 'US 10-year', sub: 'Treasury yield', flag: '🏛️', v: null, kind: 'fx', level: this.num(y.last, 2) + '%', d1: null, bp: this.bp(y.bp) });
    const vix = this.gauge('vix');
    if (vix) out.push({ key: 'vix', name: 'VIX', sub: 'S&P 500 fear gauge — up = more fear', flag: '⚡', v: null, kind: 'equity', level: this.num(vix.last, 1), d1: vix.local?.['1d'] ?? null });
    return out;
  });

  readonly countries = computed(() => {
    const s = this.snap(); if (!s) return [];
    const c = this.cls();
    return s.countries.filter((x) => c === 'all' || x.cls === c);
  });
  /** the map: regions sized to their rows; tiles best → worst */
  readonly regions = computed(() => {
    const cols = this.cls() === 'all' ? 6 : 5;
    return REGIONS.map((r) => {
      const rows = this.countries().filter((c) => c.region === r).sort((a, b) => (this.cmv(b) ?? -1e9) - (this.cmv(a) ?? -1e9));
      const vals = rows.map((c) => this.cmv(c)).filter((v): v is number => v !== null);
      return { name: r, rows, cols, lines: Math.ceil(rows.length / cols), avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null, up: vals.filter((v) => v > 0).length, n: vals.length };
    }).filter((r) => r.rows.length);
  });
  /** the matrix: every country × every period, sorted by the chosen period */
  readonly matrix = computed(() => [...this.countries()].sort((a, b) => (this.cmv(b) ?? -1e9) - (this.cmv(a) ?? -1e9)));
  readonly breadth = computed(() => {
    const all = this.countries().map((c) => ({ c, v: this.cmv(c) })).filter((x): x is { c: GCountry; v: number } => x.v !== null);
    if (!all.length) return null;
    const avg = (xs: { v: number }[]) => (xs.length ? xs.reduce((s, x) => s + x.v, 0) / xs.length : null);
    return { up: all.filter((x) => x.v > 0).length, down: all.filter((x) => x.v < 0).length,
             dm: avg(all.filter((x) => x.c.cls === 'DM')), em: avg(all.filter((x) => x.c.cls === 'EM')) };
  });

  readonly commodityGroups = computed(() => {
    const cs = this.snap()?.commodities ?? [];
    return ['Energy', 'Precious metals', 'Industrial metals', 'Agriculture'].map((g) => ({ name: g, rows: cs.filter((c) => c.group === g) }));
  });
  /** currencies best → worst against the US$ (or the rupee) */
  readonly currencies = computed(() => {
    const cs = [...(this.snap()?.currencies ?? [])].filter((c) => !(this.basis() === 'inr' && c.ccy === 'INR'));
    return cs.sort((a, b) => (this.fxmv(b) ?? -1e9) - (this.fxmv(a) ?? -1e9));
  });
  readonly fxUpDown = computed(() => {
    const vs = this.currencies().map((c) => this.fxmv(c)).filter((v): v is number => v !== null);
    return { up: vs.filter((v) => v > 0).length, down: vs.filter((v) => v < 0).length };
  });

  // ───────────────────────────── heat ─────────────────────────────
  heat(v: number | null | undefined, kind: Kind = 'equity', p: GPeriod = this.period()): string {
    if (v === null || v === undefined) return 'var(--surface-2)';
    const t = Math.max(-1, Math.min(1, v / CAPS[kind][p]));
    const pct = Math.round(10 + Math.abs(t) * 80);
    return `color-mix(in srgb, ${t >= 0 ? '#2E6B4F' : '#B4402F'} ${pct}%, #F4F0E8)`;
  }
  ink(v: number | null | undefined, kind: Kind = 'equity', p: GPeriod = this.period()): string {
    if (v === null || v === undefined) return 'var(--muted)';
    return Math.abs(v / CAPS[kind][p]) > 0.42 ? '#fff' : 'var(--ink)';
  }

  // ───────────────────────────── hover cards ─────────────────────────────
  private place(ev: Event): { x: number; y: number } {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 150, Math.max(150, r.left + r.width / 2));
    const below = r.bottom + 230 < window.innerHeight;
    return { x, y: below ? r.bottom + 6 : r.top - 6 - 222 };
  }
  private allPeriods(m: GMoves | null | undefined, kind: Kind) {
    return PERIODS.map((p) => ({ label: p.l, v: m?.[p.k] ?? null, kind }));
  }
  hoverCountry(c: GCountry, ev: Event): void {
    const p = this.period(), src = c.perf.src[p];
    this.tip.set({ ...this.place(ev), title: `${c.flag} ${c.name}`, sub: `${c.cls === 'DM' ? 'Developed' : 'Emerging'} · ${c.index_name || 'MSCI ' + c.name + ' ETF'} · ${c.ccy}`,
      level: `Index ${this.pct(c.perf.local[p])} · ${c.ccy} ${c.ccy === 'USD' ? '—' : this.pct(this.basis() === 'inr' ? this.ccyVsInr(c, p) : c.fx[p])} · ${this.basisLabel()} ${this.pct(this.cmv(c))}`,
      rows: this.allPeriods(c.perf[this.basis()], 'equity'),
      note: src === 'etf' ? `From the MSCI ${c.name} ETF (${c.etf}) — no local-index history on the feed` : !src ? 'Only today’s move is published' : undefined });
  }
  hoverCommodity(c: GCommodity, ev: Event): void {
    this.tip.set({ ...this.place(ev), title: c.name, sub: `${c.group} · front-month future · ${this.basis() === 'inr' ? '₹' : 'US$'}${c.unit}`,
      level: `${this.price(c)} · 52-week ${this.num(c.lo52)}–${this.num(c.hi52)}`, rows: this.allPeriods(this.basis() === 'inr' ? c.inr : c.usd, 'commodity') });
  }
  hoverCurrency(c: GCurrency, ev: Event): void {
    const inrB = this.basis() === 'inr';
    this.tip.set({ ...this.place(ev), title: `${c.flag} ${c.ccy} · ${c.name}`, sub: `Its value against the ${inrB ? 'rupee' : 'US dollar'} — up = it strengthened${c.pegged ? ' · pegged to the US$' : ''}`,
      level: inrB ? `₹${this.num(c.inr_per)} per ${c.ccy}` : `${this.num(c.per_usd)} per US$`, rows: this.allPeriods(inrB ? c.vs_inr : c.vs_usd, 'fx') });
  }
  hoverStrip(k: string, ev: Event): void {
    const s = this.snap(); if (!s) return;
    const m = s.msci.find((x) => x.key === k);
    if (m) { this.tip.set({ ...this.place(ev), title: m.name, sub: m.about + ' · US$, price', level: this.num(m.last, 2), rows: this.allPeriods(this.basis() === 'inr' ? m.inr : m.usd, 'equity') }); return; }
    if (k === 'fx:INR') { const r = this.inr(); if (r) this.tip.set({ ...this.place(ev), title: '🇮🇳 Indian rupee', sub: 'The rupee’s value against the US$ — down = it weakened', level: `₹${this.num(r.per_usd, 2)} per US$`, rows: this.allPeriods(r.vs_usd, 'fx') }); return; }
    const g = s.gauges.find((x) => x.key === k);
    if (g) { this.tip.set({ ...this.place(ev), title: g.name, sub: g.about, level: this.num(g.last, 2) + (g.kind === 'yield' ? '%' : ''), rows: this.allPeriods(g.local, g.kind === 'yield' ? 'fx' : 'equity') }); return; }
    const c = k.startsWith('cmd:') ? this.commodity(k.slice(4)) : null;
    if (c) this.hoverCommodity(c, ev);
  }
  ccyVsInr(c: GCountry, p: GPeriod): number | null {
    if (c.ccy === 'INR') return 0;
    if (c.ccy === 'USD') { const r = this.inr()?.vs_usd[p]; return r == null ? null : (1 / (1 + r / 100) - 1) * 100; }
    return this.snap()?.currencies.find((x) => x.ccy === c.ccy)?.vs_inr[p] ?? null;
  }

  // ───────────────────────────── formatting ─────────────────────────────
  pct(v: number | null | undefined, dp?: number): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v), d = dp ?? (a >= 100 ? 0 : a >= 10 ? 1 : 2);
    if (a < 0.005 && d >= 2) return '0.00%';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + a.toFixed(d) + '%';
  }
  /** compact % for small cells: one decimal under 10, none above */
  cp(v: number | null | undefined): string { return v == null ? '—' : this.pct(v, Math.abs(v) >= 10 ? 0 : 1); }
  num(v: number | null | undefined, dp?: number): string {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const d = dp ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 4);
    return v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  price(c: GQuote): string {
    if (c.last == null) return '—';
    const usdinr = this.inr()?.per_usd;
    if (this.basis() !== 'inr' || !usdinr) return '$' + this.num(c.last);
    const r = c.last * usdinr;
    return '₹' + this.num(r, r >= 100 ? 0 : 2);
  }
  sign(v: number | null | undefined): 'pos' | 'neg' | '' { return v == null ? '' : v > 0.0001 ? 'pos' : v < -0.0001 ? 'neg' : ''; }
  bp(v: number | null | undefined): string { return v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' bp'; }
  ago = computed(() => {
    const t = this.loadedAt(); if (!t) return '';
    const s = Math.round((this.now() - t) / 1000);
    return s < 30 ? 'just now' : s < 90 ? '1 min ago' : `${Math.round(s / 60)} min ago`;
  });
  sessionLabel(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

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
      items: s.instruments.filter((i) => g.types.includes(i.type)).map((i) => ({ key: i.key, label: label(i) }))
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
  onEsc(): void { this.pickerOpen.set(false); this.tip.set(null); }

  nameOf(key: string): string {
    const s = this.snap(); if (!s) return key;
    const i = s.instruments.find((x) => x.key === key); if (!i) return key;
    const c = i.country ? s.countries.find((x) => x.iso === i.country) : null;
    if (c) return i.type === 'etf' ? `${c.name} (MSCI)` : c.name;
    if (i.type === 'fx') return `${i.ccy} (${i.name})`;
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
  readonly lines = computed<CompareLine[]>(() => {
    const w = this.window(); if (!w) return [];
    const b = this.basis();
    const out: CompareLine[] = [];
    for (const key of this.compare()) {
      const h = this.hist()[key]; if (!h) continue;
      const src = b === 'local' || h.type === 'yield' ? h.v : b === 'inr' ? (h.r ?? h.u) : h.u;
      const d: number[] = [], v: number[] = [];
      let i0 = -1;
      for (let i = 0; i < h.d.length; i++) {
        const x = src[i];
        if (x == null || x <= 0) continue;
        if (h.d[i] < w.start) { i0 = i; continue; }
        if (h.d[i] > w.end) break;
        d.push(h.d[i]); v.push(x);
      }
      if (i0 >= 0 && w.start - h.d[i0] < 10) { d.unshift(h.d[i0]); v.unshift(src[i0] as number); }
      if (v.length < 2) continue;
      const base = v[0];
      out.push({ key, name: this.nameOf(key), colour: this.colour(key), type: h.type, d, v: v.map((x) => (x / base - 1) * 100) });
    }
    return out;
  });
  /** each line's return over the window — the chips under the chart */
  readonly lineRet = computed(() => {
    const m: Record<string, number> = {};
    for (const l of this.lines()) m[l.key] = l.v[l.v.length - 1];
    return m;
  });
  readonly cw = computed(() => Math.max(120, this.box().w - PAD.l - PAD.r));
  readonly ch = computed(() => Math.max(80, this.box().h - PAD.t - PAD.b));
  private span = computed(() => {
    const ls = this.lines(); if (!ls.length) return null;
    const d0 = Math.min(...ls.map((l) => l.d[0])), d1 = Math.max(...ls.map((l) => l.d[l.d.length - 1]));
    let lo = 0, hi = 0;
    for (const l of ls) for (const v of l.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.06 || 1;
    return { d0, d1, lo: lo - pad, hi: hi + pad };
  });
  x(d: number): number { const s = this.span()!; return s.d1 === s.d0 ? 0 : ((d - s.d0) / (s.d1 - s.d0)) * this.cw(); }
  y(v: number): number { const s = this.span()!; return this.ch() - ((v - s.lo) / (s.hi - s.lo)) * this.ch(); }
  readonly paths = computed(() => {
    if (!this.span()) return [];
    const w = this.cw();
    return this.lines().map((l) => {
      const step = Math.max(1, Math.floor(l.d.length / (w * 1.2)));
      let p = '';
      for (let i = 0; i < l.d.length; i += step) p += (p ? 'L' : 'M') + this.x(l.d[i]).toFixed(1) + ' ' + this.y(l.v[i]).toFixed(1);
      const n = l.d.length - 1;
      if (n % step) p += 'L' + this.x(l.d[n]).toFixed(1) + ' ' + this.y(l.v[n]).toFixed(1);
      return { key: l.key, colour: l.colour, d: p, fx: l.type === 'fx' };
    });
  });
  readonly yTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const n = Math.max(3, Math.floor(this.ch() / 46));
    const raw = (s.hi - s.lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => (s.hi - s.lo) / t <= n + 1) ?? 10 * mag;
    const out: { v: number; y: number; label: string; zero: boolean }[] = [];
    for (let v = Math.ceil(s.lo / step) * step; v <= s.hi; v += step) {
      const r = +v.toFixed(6);
      out.push({ v: r, y: this.y(r), label: (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%', zero: Math.abs(r) < 1e-9 });
    }
    return out;
  });
  readonly xTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const months = (s.d1 - s.d0) / 30.4, max = Math.max(3, Math.floor(this.cw() / 80));
    const stepM = [1, 2, 3, 6, 12, 24, 36, 60].find((m) => months / m <= max) ?? 120;
    const out: { x: number; label: string }[] = [];
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
  readonly ends = computed(() => {
    if (!this.span()) return [];
    const H = this.ch();
    const ls = this.lines().map((l) => ({ key: l.key, colour: l.colour, name: l.name, value: l.v[l.v.length - 1], y0: this.y(l.v[l.v.length - 1]), y: this.y(l.v[l.v.length - 1]) }))
      .sort((a, b) => a.y - b.y);
    const gap = Math.min(28, H / Math.max(1, ls.length));
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < gap) ls[i].y = ls[i - 1].y + gap;
    const over = ls.length ? ls[ls.length - 1].y - H : 0;
    if (over > 0) for (const l of ls) l.y -= over;
    for (let i = ls.length - 2; i >= 0; i--) if (ls[i + 1].y - ls[i].y < gap) ls[i].y = ls[i + 1].y - gap;
    return ls;
  });
  onMove(ev: PointerEvent, el: Element): void {
    const s = this.span(); if (!s) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    this.hover.set(Math.round(s.d0 + f * (s.d1 - s.d0)));
  }
  readonly ctip = computed(() => {
    const day = this.hover(); if (day === null || !this.span()) return null;
    const rows = this.lines().map((l) => {
      let i = -1; for (let k = 0; k < l.d.length && l.d[k] <= day; k++) i = k;
      return i < 0 ? null : { key: l.key, name: l.name, colour: l.colour, value: l.v[i], y: this.y(l.v[i]) };
    }).filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.value - a.value);
    const x = this.x(day);
    return { x, flip: x > this.cw() * 0.6, date: new Date(day * DAY).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), rows };
  });
  readonly missing = computed(() => this.compare().filter((k) => this.hist()[k] === null).map((k) => this.nameOf(k)));
  readonly crangeLabel = computed(() => {
    const s = this.span(); if (!s) return '';
    const f = (d: number) => new Date(d * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${f(s.d0)} – ${f(s.d1)}`;
  });
}
