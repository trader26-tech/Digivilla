import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AdminService, WorldChart, WorldCpi, WorldHistory, WorldQuote } from '../admin.service';
import { Ccy, Daily, bp, cagr, change, cpiDaily, daily, dayOf, deflate, idxAt, isoOf, line, startOf, stats, today, yieldStats, years } from './world-compare';

const COLOURS = ['#387ed1', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#e87ba4', '#e34948', '#5a5f78'];
const RANGES = [{ k: '1d', l: '1D' }, { k: '5d', l: '5D' }, { k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' },
  { k: '1y', l: '1Y' }, { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' }, { k: '10y', l: '10Y' }, { k: 'max', l: 'Max' }];
/** the returns table: total for short periods, a year (CAGR) from 3 years on */
const PERIODS = [{ k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' }, { k: '1y', l: '1Y' },
  { k: '3y', l: '3Y', ann: true }, { k: '5y', l: '5Y', ann: true }, { k: '10y', l: '10Y', ann: true }];
const INTRADAY = new Set(['1d', '5d']);
const LS = 'dv_admin_world';
const CPI_COLOUR: Record<string, string> = { 'cpi:IN': '#98a0b8', 'cpi:US': '#c9a0a0' };
const W0 = 900, H0 = 300, PAD = { l: 40, r: 72, t: 14, b: 26 };
/** a fund: one NAV a day, no intraday line */
const isFundKey = (k: string) => k.startsWith('fund:');
const CITY: Record<string, string> = { Kolkata: 'Mumbai', Calcutta: 'Mumbai', Berlin: 'Frankfurt', Sao_Paulo: 'São Paulo', Mexico_City: 'Mexico City', New_York: 'New York' };
const IST = 'Asia/Kolkata';
/** YYYY-MM-DD of an instant on India's clock */
const istDay = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: IST });
/** the heat map's periods, and how big a move paints the deepest colour (% — or bp for a yield) */
const HEAT_PERIODS = [{ k: '1d', l: '1D' }, { k: '1w', l: '1W' }, { k: '1m', l: '1M' }, { k: '3m', l: '3M' }, { k: '6m', l: '6M' }, { k: 'ytd', l: 'YTD' },
  { k: '1y', l: '1Y' }, { k: '3y', l: '3Y' }, { k: '5y', l: '5Y' }];
const HEAT_CAP: Record<string, number> = { '1d': 2, '1w': 4, '1m': 8, '3m': 12, '6m': 16, ytd: 20, '1y': 25, '3y': 45, '5y': 70 };
const HEAT_CAP_BP: Record<string, number> = { '1d': 8, '1w': 20, '1m': 40, '3m': 60, '6m': 80, ytd: 100, '1y': 100, '3y': 150, '5y': 200 };
/** names that fit a heat tile (the full name is in its tooltip) */
const TILE_NAME: Record<string, string> = {
  nifty100: 'Nifty 100', midcap150: 'Midcap 150', smallcap250: 'Smallcap 250', midcap50: 'Midcap 50', banknifty: 'Bank Nifty', next50: 'Next 50',
  goldbees: 'Gold BeES', nasdaq: 'Nasdaq', nasdaq100: 'Nasdaq 100', dow: 'Dow', russell: 'Russell 2K', stoxx50: 'Stoxx 50',
  sti: 'Singapore', jakarta: 'Jakarta', shanghai: 'Shanghai', taiwan: 'Taiwan', hangseng: 'Hang Seng', kospi: 'KOSPI', nikkei: 'Nikkei', asx: 'ASX 200',
  ftse: 'FTSE 100', ftsemib: 'FTSE MIB', msciworld: 'MSCI World', tsx: 'TSX', usdinr: '$ in ₹', dxy: 'Dollar idx', eurusd: '€ in $', gbpusd: '£ in $', usdjpy: '$ in ¥',
  wti: 'WTI oil', brent: 'Brent', natgas: 'Nat gas', us3m: 'US 3M', us5y: 'US 5Y', us10y: 'US 10Y', us30y: 'US 30Y',
};
export type Session = { s: 'open' | 'pre' | 'closed' | 'nav'; label: string; at: string };

/**
 * World markets: Indian and global indices, compared like-for-like.
 *  • chart — tick any markets; 1D / 5D intraday, or any time frame from 1M to Max, or a
 *    custom window (pick dates, or drag across the chart to zoom; double-click resets);
 *  • US$ (default — each index's move combined with its currency's) or each in its own currency;
 *  • as quoted, or AFTER INFLATION (each close ÷ that day's consumer prices — US prices in US$,
 *    India's for rupee markets), with the inflation line itself drawn dashed for reference;
 *  • compare — the ticked markets side by side: returns per period, calendar years, risk.
 * 1M and longer are cut from each index's daily history (fetched once, cached 6 h on
 * the server), so switching time frames is instant.
 */
@Component({
  selector: 'app-world-today',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './world-today.component.html',
  styleUrl: './world-today.component.scss',
})
export class WorldTodayComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(AdminService);
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;
  readonly RANGES = RANGES;
  /** the chart's drawing box: 900 × 300 stretched to fit on wide screens; on a phone the
   *  plot's real pixel size, so the labels aren't squashed by preserveAspectRatio="none" */
  private readonly box = signal({ w: W0, h: H0 });
  get W(): number { return this.box().w; }
  get H(): number { return this.box().h; }

  /** the markets from Yahoo, and the funds in our villa buckets (AMFI NAVs) */
  readonly apiQuotes = signal<WorldQuote[]>([]);
  readonly fundQuotes = signal<WorldQuote[]>([]);
  readonly quotes = computed(() => [...this.apiQuotes(), ...this.fundQuotes()]);
  readonly apiRegions = signal<string[]>([]);
  /** our funds sit right after India */
  readonly regions = computed(() => {
    const r = this.apiRegions().filter((x) => x !== 'Funds');
    if (!this.fundQuotes().length) return r;
    const i = r.indexOf('India');
    return [...r.slice(0, i + 1), 'Funds', ...r.slice(i + 1)];
  });
  readonly region = signal<string>('All');
  /** the list's right-hand columns: today's session, or the last year */
  readonly cols = signal<'today' | 'year'>('today');
  /** the heat map: the period it paints, and every market's moves (1W … 1Y; 1D comes from the quotes) */
  readonly HEAT_PERIODS = HEAT_PERIODS;
  readonly hp = signal('1d');
  /** heat filters: every market / only the live ones / what opens next (soonest first) */
  readonly hs = signal<'all' | 'live' | 'next'>('all');
  readonly hr = signal('All');
  /** heat layout: blocks by region, or one ranked board (biggest rise → biggest fall) */
  readonly hsort = signal<'region' | 'rank'>('region');
  /** a phone-width heat grid: shorter tile feet */
  readonly hmNarrow = signal(false);
  private hro?: ResizeObserver;
  readonly moves = signal<Record<string, Record<string, number | null>>>({});
  /** now, ticking — every status ("open · closes 21:30") is worked out from it */
  readonly now = signal(Math.floor(Date.now() / 1000));
  private tick?: ReturnType<typeof setInterval>;
  readonly asOf = signal<number>(0);
  readonly error = signal('');
  readonly PERIODS = PERIODS;
  readonly selected = signal<string[]>(['nifty50', 'nifty500', 'sp500', 'kospi']);
  readonly range = signal('1y');
  readonly ccy = signal<Ccy>('usd');
  /** after inflation: each close ÷ consumer prices that day */
  readonly real = signal(false);
  /** the inflation lines (dashed) on the as-quoted chart — India's and the US's, each can be hidden */
  readonly cpiOff = signal<string[]>([]);
  readonly cpi = signal<WorldCpi | null>(null);
  /** custom window (day numbers) — set by the date boxes or by dragging on the chart */
  readonly from = signal<number | null>(null);
  readonly to = signal<number | null>(null);
  readonly charts = signal<Record<string, WorldChart | null>>({});
  readonly hist = signal<Record<string, WorldHistory | null>>({});
  private histLoading = new Set<string>();
  readonly loadingChart = signal(false);
  readonly hover = signal<number | null>(null);
  readonly view = signal<'periods' | 'years' | 'risk'>('periods');
  /** drag-to-zoom: chart x (0…W) where the drag started / is now */
  readonly drag = signal<{ a: number; b: number } | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (Array.isArray(s.selected) && s.selected.length) this.selected.set(s.selected.slice(0, 8));
      if (RANGES.some((r) => r.k === s.range) || s.range === 'custom') this.range.set(s.range);
      if (s.ccy === 'local') this.ccy.set('local');
      if (s.real === true) this.real.set(true);
      if (Array.isArray(s.cpiOff)) this.cpiOff.set(s.cpiOff.filter((k: string) => k === 'IN' || k === 'US'));
      if (s.range === 'custom' && s.from && s.to) { this.from.set(s.from); this.to.set(s.to); }
      if (['periods', 'years', 'risk'].includes(s.view)) this.view.set(s.view);
      if (s.cols === 'year') this.cols.set('year');
      if (HEAT_PERIODS.some((p) => p.k === s.hp)) this.hp.set(s.hp);
      if (['all', 'live', 'next'].includes(s.hs)) this.hs.set(s.hs);
      if (typeof s.hr === 'string') this.hr.set(s.hr);
      if (s.hsort === 'rank') this.hsort.set('rank');
    } catch { /* defaults */ }
    if (this.range() === 'custom' && (this.from() === null || this.to() === null)) this.range.set('1y');
    this.loadQuotes();
    this.loadCharts();
    this.loadHistory();
    this.api.worldInflation().pipe(catchError(() => of(null))).subscribe((c) => this.cpi.set(c));
    this.loadFunds();
    this.loadMoves();
    this.timer = setInterval(() => { this.loadQuotes(); this.loadFunds(); if (this.range() === '1d') this.loadCharts(); }, 60_000);
    this.tick = setInterval(() => this.now.set(Math.floor(Date.now() / 1000)), 20_000);
  }
  private remember(): void {
    try {
      localStorage.setItem(LS, JSON.stringify({ selected: this.selected(), range: this.range(), ccy: this.ccy(), real: this.real(), cpiOff: this.cpiOff(), from: this.from(), to: this.to(), view: this.view(), cols: this.cols(), hp: this.hp(), hs: this.hs(), hr: this.hr(), hsort: this.hsort() }));
    } catch { /* ignore */ }
  }
  ngAfterViewInit(): void {
    const hm = this.host.nativeElement.querySelector('.wt-hm') as HTMLElement | null;
    if (hm && typeof ResizeObserver !== 'undefined') {
      this.hro = new ResizeObserver((es) => {
        const w = es[0]?.contentRect.width;
        if (!w) return;
        this.hmNarrow.set(w < 560);
      });
      this.hro.observe(hm);
    }
    const el = this.host.nativeElement.querySelector('.wt-plot') as HTMLElement | null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver((es) => {
      const c = es[0]?.contentRect;
      if (!c?.width || !c.height) return;
      const next = c.width < 600 ? { w: Math.round(c.width), h: Math.round(c.height) } : { w: W0, h: H0 };
      const cur = this.box();
      if (next.w !== cur.w || next.h !== cur.h) this.box.set(next);
    });
    this.ro.observe(el);
  }
  ngOnDestroy(): void { clearInterval(this.timer); clearInterval(this.tick); this.ro?.disconnect(); this.hro?.disconnect(); }

  loadQuotes(): void {
    this.api.worldQuotes().subscribe({
      next: (q) => { this.apiQuotes.set(q.indices); this.apiRegions.set(q.regions); this.asOf.set(q.as_of); this.error.set(q.indices.length ? '' : 'Market data is unavailable right now.'); },
      error: () => this.error.set('Market data is unavailable right now.'),
    });
  }
  /** intraday lines (1D / 5D) come from the chart endpoint; everything longer from the daily history */
  loadCharts(): void {
    const keys = this.selected().filter((k) => !isFundKey(k)), r = this.range();   // a fund has one NAV a day — no intraday line
    if (!INTRADAY.has(r)) return;
    if (!keys.length) { this.charts.set({}); return; }
    this.loadingChart.set(true);
    forkJoin(keys.map((k) => this.api.worldChart(k, r, this.ccy()).pipe(catchError(() => of(null))))).subscribe((res) => {
      const out: Record<string, WorldChart | null> = {};
      keys.forEach((k, i) => (out[k] = res[i]));
      this.charts.set(out);
      this.loadingChart.set(false);
    });
  }

  /** the villa buckets' funds: latest NAV from AMFI, its date, the move vs the NAV before */
  private loadMoves(): void {
    this.api.worldMoves().pipe(catchError(() => of(null))).subscribe((m) => { if (m?.moves) this.moves.set(m.moves); });
  }
  private loadFunds(): void {
    this.api.worldFunds().pipe(catchError(() => of(null))).subscribe((f) => { if (f?.indices?.length) this.fundQuotes.set(f.indices); });
  }

  /** each selected market's (or fund's) daily history, fetched once */
  loadHistory(): void {
    for (const k of this.selected()) {
      if (k in this.hist() || this.histLoading.has(k)) continue;
      this.histLoading.add(k);
      this.api.worldHistory(k).pipe(catchError(() => of(null))).subscribe((h) => {
        this.histLoading.delete(k);
        this.hist.set({ ...this.hist(), [k]: h });
      });
    }
  }
  readonly fundsOnly = computed(() => this.selected().length > 0 && this.selected().every(isFundKey));
  readonly histPending = computed(() => { this.hist(); return this.selected().some((k) => !(k in this.hist())); });

  toggle(key: string): void {
    const s = this.selected();
    this.selected.set(s.includes(key) ? s.filter((k) => k !== key) : [...s, key].slice(-8));
    this.remember();
    this.loadCharts();
    this.loadHistory();
  }
  setRange(r: string): void { this.range.set(r); this.hover.set(null); this.remember(); this.loadCharts(); }
  setCcy(c: Ccy): void { if (c === this.ccy()) return; this.ccy.set(c); this.remember(); this.loadCharts(); }
  setView(v: 'periods' | 'years' | 'risk'): void { this.view.set(v); this.remember(); }
  setReal(on: boolean): void { this.real.set(on); this.hover.set(null); this.remember(); }
  /** hide / show one inflation line ('IN' or 'US') */
  toggleCpi(k: string): void { const o = this.cpiOff(); this.cpiOff.set(o.includes(k) ? o.filter((x) => x !== k) : [...o, k]); this.remember(); }
  readonly CPI_KEYS = [{ k: 'IN', name: 'India inflation' }, { k: 'US', name: 'US inflation' }];

  // ── inflation ──
  /** US and India consumer prices as daily series */
  readonly cpiDays = computed(() => {
    const c = this.cpi();
    return c ? { US: cpiDaily(c.US, 'cpi:US', 'US inflation'), IN: cpiDaily(c.IN, 'cpi:IN', 'India inflation') } : null;
  });
  /** whose prices a market is measured against: US prices in US$; in local currency, its own
   *  country's — only rupee and dollar markets have one (null = no inflation series for it) */
  private cpiFor(h: WorldHistory): Daily | null {
    const c = this.cpiDays();
    if (!c) return null;
    if (this.ccy() === 'usd') return c.US;
    return h.currency === 'INR' ? c.IN : h.currency === 'USD' ? c.US : null;
  }
  /** markets left off the after-inflation view (local currency without a price index) */
  readonly noReal = computed(() => {
    if (!this.real() || this.intraday() || !this.cpi()) return [] as string[];
    const h = this.hist();
    return this.selected().filter((k) => h[k] && !this.isYield(k) && !this.cpiFor(h[k]!)).map((k) => h[k]!.name);
  });
  /** the dashed inflation lines on the as-quoted chart — India's and the US's (in either currency
   *  view: each is how much prices rose at home, the bar a market there had to clear) */
  readonly cpiLines = computed<Daily[]>(() => {
    const c = this.cpiDays();
    if (!c || this.real() || this.intraday()) return [];
    return (['IN', 'US'] as const).filter((k) => !this.cpiOff().includes(k)).map((k) => c[k]);
  });
  /** "India prices after Dec 2025 are estimated at 2.6% a year" — for the footnote */
  readonly cpiNote = computed(() => {
    const c = this.cpi();
    if (!c || this.intraday() || (!this.real() && !this.cpiLines().length)) return '';
    const used = this.real() ? (this.ccy() === 'usd' ? ['US'] : ['IN', 'US']) : this.cpiLines().map((l) => l.key.slice(4));
    const f = (d: number) => new Date(d * 86400000).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return (used as ('US' | 'IN')[]).filter((k) => c[k].estimated_from).map((k) =>
      `${k === 'IN' ? 'India' : 'US'} prices after ${f(c[k].last_actual)} are estimated at the latest yearly rate (${c[k].latest_yoy?.toFixed(1)}%).`).join(' ');
  });

  // ── the window ──
  /** the daily series in the chosen currency, for the selected markets that have loaded */
  readonly series = computed<Daily[]>(() => {
    const h = this.hist(), c = this.ccy(), q = this.quotes();
    return this.selected().map((k) => {
      const x = h[k];
      if (!x) return null;
      const s = daily(x, c);
      // add today's live price if the history doesn't have today yet
      const lq = q.find((y) => y.key === k), live = lq ? (c === 'usd' ? lq.usd_last : lq.last) : null;
      const day = lq?.time ? Math.floor(lq.time / 86400) : null;
      if (live && day !== null && s.d.length && day > s.d[s.d.length - 1]) { s.d.push(day); s.v.push(live); }
      // after inflation: ÷ that day's consumer prices (yields are rates — shown as quoted)
      if (this.real() && !this.intraday() && !s.yield) { const c = this.cpiFor(x); return c ? deflate(s, c) : null; }
      return s;
    }).filter((s): s is Daily => !!s && s.d.length > 1);
  });
  /** the last day any market has a close (the window's natural end) */
  readonly lastDay = computed(() => Math.max(0, ...this.series().map((s) => s.d[s.d.length - 1])) || today());
  readonly firstDay = computed(() => { const ss = this.series(); return ss.length ? Math.min(...ss.map((s) => s.d[0])) : today() - 3650; });
  /** [from, to] day numbers of the chart window (long time frames and custom) */
  readonly window = computed<[number, number]>(() => {
    const end = this.lastDay();
    if (this.range() === 'custom' && this.from() !== null && this.to() !== null) return [this.from()!, this.to()!];
    return [Math.max(startOf(this.range(), end, this.firstDay()), this.firstDay()), end];
  });
  readonly fromIso = computed(() => isoOf(this.window()[0]));
  readonly toIso = computed(() => isoOf(this.window()[1]));
  readonly minIso = computed(() => isoOf(this.firstDay()));
  readonly maxIso = computed(() => isoOf(this.lastDay()));
  setFrom(e: Event): void { this.setCustom(dayOf((e.target as HTMLInputElement).value), this.window()[1]); }
  setTo(e: Event): void { this.setCustom(this.window()[0], dayOf((e.target as HTMLInputElement).value)); }
  private setCustom(a: number, b: number): void {
    if (!isFinite(a) || !isFinite(b)) return;
    if (a > b) [a, b] = [b, a];
    if (b - a < 5) return;
    this.from.set(a); this.to.set(b); this.range.set('custom'); this.hover.set(null); this.remember();
  }
  /** just the length, beside the date boxes: "3 yrs 2 mos" */
  readonly windowSpan = computed(() => this.windowLabel().split(' · ')[0]);
  /** the window in words: "3 yrs 2 mos · 12 Jan 2023 → 8 Oct 2026" */
  readonly windowLabel = computed(() => {
    const [a, b] = this.window(), days = b - a;
    let y = Math.floor(days / 365.25), m = Math.round((days - y * 365.25) / 30.44);
    if (m >= 12) { y += 1; m = 0; }
    const span = y ? `${y} yr${y > 1 ? 's' : ''}${m ? ` ${m} mo${m > 1 ? 's' : ''}` : ''}` : `${Math.max(1, Math.round(days / 30.44))} mo${days > 45 ? 's' : ''}`;
    const f = (d: number) => new Date(d * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `${span} · ${f(a)} → ${f(b)}`;
  });
  colour(key: string): string { if (CPI_COLOUR[key]) return CPI_COLOUR[key]; const i = this.selected().indexOf(key); return i >= 0 ? COLOURS[i % COLOURS.length] : 'transparent'; }
  quote(key: string): WorldQuote | undefined { return this.quotes().find((q) => q.key === key); }

  readonly REGION_NAME: Record<string, string> = { India: 'India', Funds: 'Our funds', US: 'United States', Americas: 'Americas', Asia: 'Asia-Pacific', Europe: 'Europe',
    Global: 'Global', Currencies: 'Currencies', Bonds: 'US Treasury yields', Commodities: 'Commodities' };
  /** the heat map's label cells: names that fit one */
  readonly HEAT_LABEL: Record<string, string> = { US: 'US', Funds: 'Our funds', Bonds: 'US yields', Asia: 'Asia-Pac', Commodities: 'Commodity', Currencies: 'Currency' };
  readonly FUNDS_ABOUT = 'One NAV a business day, struck at the 3:30 pm close and published by AMFI in the evening';
  readonly PAD = PAD;
  /** the table, one block per region */
  readonly groups = computed(() => {
    const rs = this.region() === 'All' ? this.regions() : [this.region()];
    return rs.map((r) => {
      const items = this.quotes().filter((q) => q.region === r);
      const moves = items.filter((q) => !this.isYield(q.key) && q.kind !== 'fx' && q.key !== 'vix').map((q) => q.change_pct).filter((v): v is number => v !== null);
      return { region: r, name: this.REGION_NAME[r] ?? r, items, avg: moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null };
    }).filter((g) => g.items.length);
  });
  /** where today's price sits in its 52-week range (0–100) */
  pos52(q: WorldQuote): number | null {
    if (q.last === null || q.low_52w === null || q.high_52w === null || q.high_52w <= q.low_52w) return null;
    if (q.kind === 'yield' && q.low_52w <= 0) return null;          // Yahoo sends 0 for some yields' 52-week low
    return Math.max(0, Math.min(100, ((q.last - q.low_52w) / (q.high_52w - q.low_52w)) * 100));
  }
  readonly breadth = computed(() => {
    // yields aren't "up" or "down" markets — count the priced ones only
    const qs = this.apiQuotes().filter((q) => q.change_pct !== null && !q.kind && q.key !== 'vix');
    return { up: qs.filter((q) => q.change_pct! > 0).length, down: qs.filter((q) => q.change_pct! < 0).length };
  });
  readonly hasYield = computed(() => this.selected().some((k) => this.isYield(k)));
  isYield(key: string): boolean { return this.quote(key)?.kind === 'yield' || !!this.hist()[key]?.kind?.includes('yield'); }
  /** basis points, signed: "+38 bp" */
  bps(v: number | null | undefined): string { return v === null || v === undefined || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(0) + ' bp'; }
  /** a market's today move as shown: bp for a yield, % for the rest (US$ or local) */
  todayMove(key: string): { v: number | null; text: string } {
    const q = this.quote(key);
    if (!q) return { v: null, text: '—' };
    if (q.kind === 'yield') return { v: q.change_bp ?? null, text: this.bps(q.change_bp) };
    const v = (this.ccy() === 'usd' ? q.usd_change_pct : q.change_pct) ?? null;
    return { v, text: this.pct(v) };
  }

  /** the chart: one line per selected index — % change from the start of the range */
  readonly intraday = computed(() => INTRADAY.has(this.range()));
  readonly plot = computed(() => {
    let series: { key: string; name: string; base: number; pts: [number, number][] }[];
    if (this.intraday()) {
      const ch = this.charts(), keys = this.selected().filter((k) => ch[k]?.points?.length);
      series = keys.map((k) => {
        const c = ch[k]!;
        // 1D: measure from yesterday's close, so the line shows today's move exactly
        const base = this.range() === '1d' && c.prev_close ? c.prev_close : c.points[0][1];
        return { key: k, name: c.name, base, pts: c.points.map(([t, v]) => [t, (v / base - 1) * 100] as [number, number]) };
      });
    } else {
      const [a, b] = this.window();
      series = [...this.series(), ...this.cpiLines()].map((s) => ({ key: s.key, name: s.name, base: s.v[Math.max(0, idxAt(s, a))], pts: line(s, a, b) })).filter((s) => s.pts.length > 1);
    }
    if (!series.length) return null;
    // 1D / 5D: markets trade at different hours — plot each one across ITS OWN session (0 → 1),
    // so every line starts at the open and ends at the latest price. Longer ranges use real dates.
    const session = this.range() === '1d' || this.range() === '5d';
    const W = this.W, H = this.H;
    if (session) for (const s of series) { const n = s.pts.length - 1 || 1; s.pts = s.pts.map((p, i) => [i / n, p[1]] as [number, number]); }
    const ts = series.flatMap((s) => s.pts.map((p) => p[0])), vs = series.flatMap((s) => s.pts.map((p) => p[1]));
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
    const pad = (hi - lo) * 0.08 || 0.5; lo -= pad; hi += pad;
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const ticks = this.ticks(lo, hi).map((v) => ({ v, y: y(v), label: (v > 0 ? '+' : '') + v.toFixed(Math.abs(hi - lo) < 4 ? 1 : 0) + '%' }));
    const lines = series.map((s) => ({
      key: s.key, name: s.name, colour: this.colour(s.key), dash: s.key.startsWith('cpi:'),
      d: s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''),
      last: s.pts[s.pts.length - 1][1], ly: y(s.pts[s.pts.length - 1][1]),
    }));
    const xl = session
      ? [{ x: x(0), label: this.range() === '1d' ? 'Open' : '5 days ago', anchor: 'start' }, { x: x(1), label: 'Now', anchor: 'end' }]
      : [t0, t0 + (t1 - t0) / 2, t1].map((t, i) => ({ x: x(t), label: this.tLabel(t), anchor: i === 0 ? 'start' : i === 2 ? 'end' : 'middle' }));
    return { lines, ticks, zero: y(0), xl, t0, t1, series, x, y };
  });

  private ticks(lo: number, hi: number): number[] {
    const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= 5) ?? 10 * mag;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6));
    return out;
  }
  tLabel(t: number, long = false): string {
    const d = new Date(t * 1000), r = this.range();
    if (r === '1d') return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    const [a, b] = this.window();
    if (long || r === '5d' || b - a < 200) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: long ? 'numeric' : undefined, timeZone: 'UTC' });
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  /** hover: the nearest point in time on each line */
  private px(e: MouseEvent, svg: Element): number {
    const b = svg.getBoundingClientRect(), W = this.W;
    return Math.max(PAD.l, Math.min(W - PAD.r, ((e.clientX - b.left) / b.width) * W));
  }
  private tAt(px: number): number { const p = this.plot()!; return p.t0 + ((px - PAD.l) / (this.W - PAD.l - PAD.r)) * (p.t1 - p.t0); }
  move(e: MouseEvent, svg: Element): void {
    const p = this.plot();
    if (!p) return;
    const px = this.px(e, svg);
    const d = this.drag();
    if (d) this.drag.set({ a: d.a, b: px });
    this.hover.set(Math.max(p.t0, Math.min(p.t1, this.tAt(px))));
  }
  /** drag across the chart to zoom into that stretch (not on 1D / 5D) */
  down(e: MouseEvent, svg: Element): void {
    // a finger scrubs (shows the readout) rather than zooming — zoom on a phone is the date boxes
    if ((e as PointerEvent).pointerType === 'touch') { this.move(e, svg); return; }
    if (this.intraday() || !this.plot() || e.button !== 0) return;
    const px = this.px(e, svg);
    this.drag.set({ a: px, b: px });
  }
  up(): void {
    const d = this.drag();
    this.drag.set(null);
    if (!d || Math.abs(d.b - d.a) < 12) return;
    this.setCustom(Math.round(this.tAt(Math.min(d.a, d.b)) / 86400), Math.round(this.tAt(Math.max(d.a, d.b)) / 86400));
  }
  /** a mouse leaving clears the readout and any drag; a lifted finger keeps the readout */
  leave(e: PointerEvent): void {
    this.drag.set(null);
    if (e.pointerType !== 'touch') this.hover.set(null);
  }
  /** touch: a tap anywhere off the chart clears the readout (pointerdown: iOS won't bubble taps as clicks) */
  @HostListener('document:pointerdown', ['$event'])
  onDocPointer(e: PointerEvent): void {
    if (this.hover() !== null && !(e.target as Element)?.closest?.('.wt-plot svg')) this.hover.set(null);
  }
  /** "Custom" button: start from the window on screen, so the dates can be nudged */
  setCustomFromNow(): void { const [a, b] = this.window(); this.setCustom(a, b); }
  /** a market's return over the chart window (for its legend chip) */
  winOf(key: string): { ret: number; text: string } | null {
    const r = this.compareRows().find((x) => x.key === key);
    if (r?.ywin) return { ret: r.ywin.bp, text: this.bps(r.ywin.bp) };
    return r?.win ? { ret: r.win.ret, text: this.pct(r.win.ret) } : null;
  }
  /** double-click: back out of a zoom */
  reset(): void { if (this.range() === 'custom') this.setRange('1y'); }
  /** value pills at the line ends, nudged apart so they never overlap */
  readonly ends = computed(() => {
    const p = this.plot(); if (!p) return [];
    const top = PAD.t, bottom = this.H - PAD.b;
    const ls = p.lines.map((l) => {
      const label = this.pct(l.last);
      return { key: l.key, colour: l.colour, label, y0: l.ly, y: l.ly, w: label.length * 6.6 + 12 };
    }).sort((a, b) => a.y - b.y);
    const gap = Math.min(22, (bottom - top) / Math.max(1, ls.length));
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < gap) ls[i].y = ls[i - 1].y + gap;
    const over = ls.length ? ls[ls.length - 1].y - bottom : 0;
    if (over > 0) for (const l of ls) l.y -= over;
    for (let i = ls.length - 2; i >= 0; i--) if (ls[i + 1].y - ls[i].y < gap) ls[i].y = ls[i + 1].y - gap;
    return ls;
  });
  readonly dragBox = computed(() => { const d = this.drag(); return d && Math.abs(d.b - d.a) > 2 ? { x: Math.min(d.a, d.b), w: Math.abs(d.b - d.a) } : null; });
  readonly hoverRows = computed(() => {
    const p = this.plot(), t = this.hover();
    if (!p || t === null) return null;
    const rows = p.series.map((s) => {
      let best = s.pts[0];
      for (const q of s.pts) if (Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q;
      const yld = this.isYield(s.key), level = s.base * (1 + best[1] / 100);
      return { key: s.key, name: s.name, colour: this.colour(s.key), v: best[1], y: p.y(best[1]),
               text: yld ? `${level.toFixed(2)}% (${this.bps((level - s.base) * 100)})` : this.pct(best[1]) };
    });
    rows.sort((a, b) => b.v - a.v);
    const session = this.intraday();
    return { x: p.x(t), label: session ? `${Math.round(t * 100)}% through the session` : this.tLabel(t, true), rows, left: p.x(t) > this.W * 0.55 };
  });

  // ── compare: the ticked markets side by side ──
  readonly compareRows = computed(() => {
    const end = this.lastDay(), [a, b] = this.window();
    return [...this.series(), ...this.cpiLines()].map((s) => ({
      key: s.key, name: s.name, colour: this.colour(s.key),
      yield: !!s.yield, cpi: !!s.cpi,
      // a yield: its move in bp over each period (no "a year" — a rate doesn't compound)
      periods: Object.fromEntries(PERIODS.map((p) => {
        const from = startOf(p.k, end, s.d[0]);
        if (s.yield) return [p.k, bp(s, from, end)];
        const pct = change(s, from, end);
        return [p.k, p.ann ? cagr(pct, end - from) : pct];
      })) as Record<string, number | null>,
      win: s.yield ? null : stats(s, a, b),
      ywin: s.yield ? yieldStats(s, a, b) : null,
      years: years(s, this.yearCols(), end),
    }));
  });
  /** the last 10 calendar years, newest first */
  yearCols(): number[] { const y = new Date(this.lastDay() * 86400000).getUTCFullYear(); return Array.from({ length: 10 }, (_, i) => y - i); }
  readonly YEARS = computed(() => this.yearCols());
  /** best and worst in each column, for the highlight */
  readonly extremes = computed(() => {
    const rows = this.compareRows(), out: Record<string, { hi: number; lo: number }> = {};
    const add = (col: string, v: number | null | undefined) => {
      if (v === null || v === undefined || !isFinite(v)) return;
      const e = (out[col] ||= { hi: -Infinity, lo: Infinity }); e.hi = Math.max(e.hi, v); e.lo = Math.min(e.lo, v);
    };
    for (const r of rows) {
      if (r.yield || r.cpi) continue; // bp aren't comparable with % returns; inflation is the yardstick
      for (const p of PERIODS) add('p:' + p.k, r.periods[p.k]);
      for (const y of this.YEARS()) add('y:' + y, r.years[y]);
      if (r.win) { add('w:ret', r.win.ret); add('w:cagr', r.win.cagr); add('w:vol', -(r.win.vol ?? NaN)); add('w:dd', r.win.dd); add('w:best', r.win.best); add('w:worst', r.win.worst); }
    }
    return out;
  });
  /** a cell's tint: green / red by sign, stronger the bigger the move */
  heat(v: number | null | undefined, scale = 30): string {
    if (v === null || v === undefined || !isFinite(v)) return 'transparent';
    const a = Math.min(1, Math.abs(v) / scale) * 22 + 4;
    return `color-mix(in srgb, var(${v >= 0 ? '--positive' : '--negative'}) ${a.toFixed(0)}%, transparent)`;
  }
  isBest(col: string, v: number | null | undefined, invert = false): boolean {
    const e = this.extremes()[col];
    return !!e && v !== null && v !== undefined && this.compareRows().filter((r) => !r.yield && !r.cpi).length > 1 && (invert ? -v : v) === e.hi;
  }

  /** the table shows each market in ITS OWN currency (what the news reports); the chart's currency switch is separate */
  flagOf(q: WorldQuote): string { return q.flag || (q.kind === 'fund' ? '◆' : ''); }
  sub(q: WorldQuote): string {
    if (q.kind === 'yield') return '% a year';
    if (q.kind === 'fund') return q.unit === 'large' || q.unit === 'mid' || q.unit === 'small' ? q.unit + ' cap' : (q.unit || 'fund');
    if (q.kind === 'fx') return '';
    return q.unit ? (q.currency || '') + ' · ' + q.unit.replace('$', '') : (q.currency || '');
  }
  /** the day's move in the market's own units: points for an index, bp for a yield */
  chgText(q: WorldQuote): string {
    if (q.kind === 'yield') return this.bps(q.change_bp);
    const v = q.change;
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  /** the time of the latest price, on the exchange's clock; a villa shows its last close's date */
  localClock(q: WorldQuote): string {
    if (!q.time) return '—';
    const d = new Date(q.time * 1000);
    try { return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: q.tz || undefined }); } catch { return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  }
  /** "Session of 14 Oct · vs the 13 Oct close" — which sessions a day's move compares */
  sessionNote(q: WorldQuote): string {
    const f = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    if (q.kind === 'fund') return (q.nav_date ? 'NAV of ' + f(q.nav_date) : 'Latest NAV') + (q.prev_date ? ' · vs ' + f(q.prev_date) : '');
    return (q.session ? 'Session of ' + f(q.session) : 'Latest price') + (q.prev_date ? ' · vs the ' + f(q.prev_date) + ' close' : '');
  }
  /** a chart row's level in the chart's currency */
  levelOf(key: string): string {
    const q = this.quote(key); if (!q) return '';
    if (q.kind === 'yield') return this.num(q.last) + '%';
    return this.num(this.ccy() === 'usd' ? q.usd_last : q.last);
  }
  spark(q: WorldQuote): string {
    const v = q.spark;
    if (!v || v.length < 2) return '';
    const base = q.usd_prev ?? q.prev_close ?? v[0];
    const all = [...v, base], lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    return v.map((x, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * 100).toFixed(1)},${(28 - ((x - lo) / span) * 26).toFixed(1)}`).join('');
  }
  baseY(q: WorldQuote): number {
    const v = q.spark, base = q.usd_prev ?? q.prev_close ?? v?.[0];
    if (!v?.length || base == null) return 14;
    const all = [...v, base], lo = Math.min(...all), hi = Math.max(...all);
    return 28 - ((base - lo) / (hi - lo || 1)) * 26;
  }
  // ── sessions: open / closed, closing time, last update — all on India's clock ──
  /** "15:30" today, "Fri 15:30" within a week, "26 Oct 15:30" beyond */
  ist(ts: number | null | undefined): string {
    if (!ts) return '—';
    const d = new Date(ts * 1000), hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST });
    const day = istDay(ts), today = istDay(this.now());
    if (day === today) return hm;
    const gap = Math.abs(Date.parse(day) - Date.parse(today)) / 86400000;
    return (gap <= 6 ? d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: IST }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: IST })) + ' ' + hm;
  }
  /** a date in words: "today", "yesterday", "Fri", "26 Oct" */
  dayWord(iso: string): string {
    const gap = Math.round((Date.parse(istDay(this.now())) - Date.parse(iso)) / 86400000);
    if (gap === 0) return 'today';
    if (gap === 1) return 'yesterday';
    const d = new Date(iso + 'T12:00:00Z');
    return gap > 1 && gap <= 6 ? d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  /** "4 min ago", "3 h ago", "2 d ago" */
  ago(ts: number | null | undefined): string {
    if (!ts) return '';
    const s = Math.max(0, this.now() - ts);
    return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  }
  /** a market's session right now: open (and when it closes), not yet open, or closed (and when) */
  status(q: WorldQuote): Session {
    const n = this.now();
    if (q.kind === 'fund') {
      const today = istDay(n), wd = new Date(n * 1000).toLocaleDateString('en-GB', { weekday: 'short', timeZone: IST });
      const weekday = !['Sat', 'Sun'].includes(wd);
      const next = q.nav_date === today || !weekday ? 'Next: ' + (wd === 'Fri' || wd === 'Sat' || wd === 'Sun' ? 'Mon' : 'tomorrow') + ' eve' : 'Next: tonight';
      return { s: 'nav', label: 'NAV ' + (q.nav_date ? this.dayWord(q.nav_date) : '—'), at: next };
    }
    const o = q.open_at, c = q.close_at, t = q.time;
    if (o && c) {
      if (n >= o && n < c) {
        if (t && n - t < 1800) return { s: 'open', label: 'Open', at: 'Closes ' + this.ist(c) };
        // inside its hours but no fresh price: paused (a rate between sessions) — or a holiday when nothing came all day
        if (t && n - t < 20 * 3600) return { s: 'closed', label: 'Paused', at: 'Last ' + this.ist(t) };
        return { s: 'closed', label: 'Holiday', at: 'Opens ' + this.ist(this.nextOpen(q)) };
      }
      if (n < o) return { s: 'pre', label: 'Opens ' + this.ist(o), at: 'Closes ' + this.ist(c) };
      return { s: 'closed', label: 'Closed', at: 'Opens ' + this.ist(this.nextOpen(q)) };
    }
    return { s: 'closed', label: 'Closed', at: t ? this.ist(t) : '' };
  }
  /** when the market next opens: its session moved on day by day (the same wall-clock time on the
   *  exchange's own clock — daylight-saving changes kept), skipping sessions that end on a weekend.
   *  Exchange holidays aren't known, so a holiday shows the day after. */
  nextOpen(q: WorldQuote): number | null {
    const o = q.open_at, c = q.close_at, tz = q.tz || 'UTC', n = this.now();
    if (!o || !c) return null;
    if (n < o) return o;
    const hm = (ts: number) => { const [h, m] = new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).split(':').map(Number); return (h % 24) * 60 + m; };
    const wd = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-GB', { weekday: 'short', timeZone: tz });
    for (let k = 1; k <= 8; k++) {
      const cc = c + k * 86400;
      if (wd(cc) === 'Sat' || wd(cc) === 'Sun') continue;
      let t = o + k * 86400;
      let d = hm(o) - hm(t); if (d > 720) d -= 1440; if (d < -720) d += 1440;   // DST: keep the local opening time
      t += d * 60;
      if (t > n) return t;
    }
    return null;
  }
  /** the row's tooltip: the exchange, the session on its own clock, the comparison */
  rowTitle(q: WorldQuote): string {
    const own = (ts?: number | null) => ts && q.tz ? new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: q.tz }) : '';
    const city = this.cityOf(q.tz);
    const hours = q.open_at && q.close_at && q.kind !== 'fund' ? ` · ${own(q.open_at)}–${own(q.close_at)} ${city} time` : '';
    const add = this.selected().includes(q.key) ? 'Remove from the chart' : 'Add to the chart';
    return `${add} · ${q.exchange || ''}${hours} · ${this.sessionNote(q)}`;
  }
  cityOf(tz?: string | null): string { const c = (tz || '').split('/').pop() || ''; return CITY[c] ?? c.replace(/_/g, ' '); }

  setCols(c: 'today' | 'year'): void { this.cols.set(c); this.remember(); }
  /** markets trading right now (funds and the always-on ones counted as they are) */
  readonly liveQuotes = computed(() => this.apiQuotes().filter((q) => this.status(q).s === 'open'));
  readonly openCount = computed(() => this.liveQuotes().length);

  // ── the heat map: every market at once, painted by its move over the chosen period ──
  setHp(p: string): void { this.hp.set(p); this.remember(); }
  setHs(v: 'all' | 'live' | 'next'): void { this.hs.set(this.hs() === v && v !== 'all' ? 'all' : v); this.remember(); }
  setHr(r: string): void { this.hr.set(r); this.remember(); }
  setHsort(v: 'region' | 'rank'): void { this.hsort.set(v); this.remember(); }
  /** a market's move over the heat map's period: % (bp for a yield) */
  heatMove(q: WorldQuote): number | null {
    const p = this.hp();
    if (p === '1d') return (q.kind === 'yield' ? q.change_bp : q.change_pct) ?? null;
    return this.moves()[q.key]?.[p] ?? null;
  }
  heatText(q: WorldQuote): string { const v = this.heatMove(q); return q.kind === 'yield' ? this.bps(v) : this.pct(v); }
  /** how strongly a move paints (0–1): moves up to the period's cap; currencies move less, so half the cap */
  heatStrength(q: WorldQuote): number {
    const v = this.heatMove(q), p = this.hp();
    if (v === null || !isFinite(v)) return 0;
    const cap = q.kind === 'yield' ? HEAT_CAP_BP[p] : HEAT_CAP[p] * (q.kind === 'fx' || q.unit === 'arbitrage' ? 0.5 : 1);
    return Math.min(1, Math.abs(v) / cap);
  }
  heatBg(q: WorldQuote): string {
    const v = this.heatMove(q);
    if (v === null || v === 0 || !isFinite(v)) return 'var(--nw-card2)';
    const a = 10 + this.heatStrength(q) * 78;
    return `color-mix(in srgb, ${v > 0 ? '#16a085' : '#e53935'} ${a.toFixed(0)}%, #ffffff)`;
  }
  heatDeep(q: WorldQuote): boolean { return this.heatStrength(q) > 0.5; }
  /** the tile's name: no "(Japan)" — the flag says it */
  shortName(q: WorldQuote): string {
    if (TILE_NAME[q.key]) return TILE_NAME[q.key];
    let n = q.name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (q.kind === 'fund') n = n.replace(/^Nippon India /, 'Nippon ').replace(/^ICICI Prudential /, 'ICICI ').replace(/ ETF FOF$/, '').replace(/ Growth Mid Cap$/, ' Growth').replace(/ Cap$/, '').replace(/Arbitrage$/, 'Arb');
    return n;
  }
  /** the markets the heat filters let through */
  private readonly heatPool = computed(() => {
    const hs = this.hs(), hr = this.hr(); this.now();
    return this.quotes().filter((q) => (hr === 'All' || q.region === hr) &&
      (hs === 'all' || (hs === 'live' ? this.status(q).s === 'open' : q.kind !== 'fund' && this.status(q).s !== 'open' && this.nextOpen(q) !== null)));
  });
  /** the heat map's blocks: one per region — or one ranked board, or what opens next (soonest first) */
  readonly heatGroups = computed(() => {
    const pool = this.heatPool(), hs = this.hs();
    const avgOf = (items: WorldQuote[]) => {
      const vs = items.filter((q) => q.kind !== 'yield' && q.kind !== 'fx' && q.key !== 'vix').map((q) => this.heatMove(q)).filter((v): v is number => v !== null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    const block = (region: string, name: string, items: WorldQuote[]) => ({ region, name, items, avg: avgOf(items) });
    if (hs === 'next') {
      const items = [...pool].sort((a, b) => (this.nextOpen(a) ?? 0) - (this.nextOpen(b) ?? 0));
      return items.length ? [block('next', 'Opening next', items)] : [];
    }
    if (this.hsort() === 'rank') {
      // a yield's bp and a price's % don't rank together: prices first, then yields
      const v = (q: WorldQuote) => this.heatMove(q) ?? -Infinity;
      const items = [...pool.filter((q) => q.kind !== 'yield').sort((a, b) => v(b) - v(a)), ...pool.filter((q) => q.kind === 'yield').sort((a, b) => v(b) - v(a))];
      return items.length ? [block('rank', hs === 'live' ? 'Live now, ranked' : 'Every market, ranked', items)] : [];
    }
    return this.regions().map((r) => block(r, this.REGION_NAME[r] ?? r, pool.filter((q) => q.region === r))).filter((g) => g.items.length);
  });
  trackRegion = (_: number, g: { region: string }) => g.region;
  trackKey = (_: number, q: WorldQuote) => q.key;
  readonly heatCount = computed(() => this.heatPool().length);
  readonly nextCount = computed(() => this.quotes().filter((q) => q.kind !== 'fund' && this.status(q).s !== 'open' && this.nextOpen(q) !== null).length);
  /** the flag only where a block mixes countries */
  heatFlag(region: string): boolean { return !['India', 'US', 'Funds'].includes(region); }
  /** the tile's last line: when its price last moved (IST) — or, on "Opening next", when it opens */
  heatFoot(q: WorldQuote): string {
    if (q.kind === 'fund') {
      if (!q.nav_date) return 'NAV —';
      return 'NAV ' + (this.hmNarrow() ? new Date(q.nav_date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : this.dayWord(q.nav_date));
    }
    const st = this.status(q);
    if (this.hs() === 'next') return 'Opens ' + this.ist(this.nextOpen(q));
    // live: how fresh the price is (the closing time is in the tooltip and on "Opening next")
    if (st.s === 'open') { const a = this.agoShort(q.time); return this.hmNarrow() ? a : 'Live · ' + (a === 'now' ? 'just now' : a); }
    return this.ist(q.time);
  }
  /** everything about a tile, for its tooltip */
  heatTitle(q: WorldQuote): string {
    const st = this.status(q);
    const upd = q.kind === 'fund' ? `NAV of ${q.nav_date ?? '—'}` : `Last price ${this.ist(q.time)} IST (${this.ago(q.time)})`;
    return `${q.name} · ${st.label}${st.at ? ' · ' + st.at : ''} · ${upd} · tap to ${this.selected().includes(q.key) ? 'remove from' : 'add to'} the chart`;
  }
  /** "now", "4m", "3h", "2d" */
  agoShort(ts: number | null | undefined): string {
    if (!ts) return '—';
    const s = Math.max(0, this.now() - ts);
    return s < 90 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
  }
  /** "21:30" on India's clock */
  hm(ts: number): string { return new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }); }
  readonly heatLoading = computed(() => this.hp() !== '1d' && !Object.keys(this.moves()).length);
  readonly heatPeriodName = computed(() => ({ '1d': 'today', '1w': 'this week', '1m': '1 month', '3m': '3 months', '6m': '6 months', ytd: 'this year', '1y': '1 year', '3y': '3 years', '5y': '5 years' } as Record<string, string>)[this.hp()]);
  readonly heatCap = computed(() => HEAT_CAP[this.hp()]);

  num(v: number | null, dp = 2): string { return v === null || v === undefined ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  pct(v: number | null): string { return v === null || v === undefined ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; }
  clock(ts: number): string { return ts ? new Date(ts * 1000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''; }
}
