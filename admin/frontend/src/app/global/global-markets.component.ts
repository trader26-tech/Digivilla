import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';

import { AdminService, IBasket, ICatalogItem, IItem, IKind, IRange, IVilla, IndiaBoard } from '../admin.service';

/** Markets today — the India board: the three villas (editable mix, with / without gold), a heat
 *  map of the Indian indices · gold · arbitrage · rupee · US 10-year · S&P 500, and one chart of
 *  their movement over the chosen range (live 5-minute bars for 1D). Villas are replayed here in
 *  the browser from the parts' series, so a mix change redraws at once. */

type Gold = 'with' | 'without';
type Weights = Record<string, number>;
interface Line { key: string; name: string; short: string; colour: string; dash: string | null; width: number; t: number[]; v: number[]; villa: boolean; }
interface Tile { key: string; name: string; short: string; about: string; kind: IKind; pct: number | null; last: number | null; chartable: boolean; }

const RANGES: { k: IRange; l: string; long: string }[] = [
  { k: '1d', l: '1D', long: 'today' }, { k: '1w', l: '1W', long: 'this week' }, { k: '1m', l: '1M', long: '1 month' },
  { k: '3m', l: '3M', long: '3 months' }, { k: 'ytd', l: 'YTD', long: 'this year' }, { k: '1y', l: '1Y', long: '1 year' },
  { k: '3y', l: '3Y', long: '3 years' }, { k: '5y', l: '5Y', long: '5 years' }, { k: '10y', l: '10Y', long: '10 years' },
  { k: '15y', l: '15Y', long: '15 years' }, { k: 'custom', l: 'Custom', long: 'your dates' },
];
const CAP_SPANS: [IRange, number][] = [['1m', 0.085], ['3m', 0.25], ['ytd', 0.6], ['1y', 1], ['3y', 3], ['5y', 5], ['10y', 10], ['15y', 15]];
const IST = 'Asia/Kolkata';
const STORE = 'dv_admin_today';
const MAX_LINES = 8;
/** one fixed style per entity — a line keeps its colour however many are drawn */
const STYLE: Record<string, { c: string; dash?: string; w?: number }> = {
  'villa:balanced': { c: '#387ed1', w: 2.6 }, 'villa:conservative': { c: '#387ed1', dash: '9 5', w: 2.6 }, 'villa:aggressive': { c: '#387ed1', dash: '2 4', w: 2.6 },
  nifty50: { c: '#98a0b8', dash: '4 3', w: 1.8 }, n100: { c: '#5a5f78', w: 1.8 }, mid: { c: '#eb6834', w: 1.8 }, small: { c: '#1baf7a', w: 1.8 }, n500: { c: '#6250d6', w: 1.8 },
  lms_eq: { c: '#0e9bb0', w: 2.1 },
  gold: { c: '#eda100', w: 1.8 }, arbitrage: { c: '#e87ba4', dash: '2 4', w: 1.8 }, rupee: { c: '#6250d6', dash: '7 5', w: 1.8 }, sp500: { c: '#e34948', w: 1.8 },
};
/** one-tap mixes for the editor (and the starting point of a new one) */
const PRESETS: { k: string; name: string; w: Weights }[] = [
  { k: 'conservative', name: 'Conservative', w: { arbitrage: 0.7, gold: 0.075, large: 0.075, mid: 0.075, small: 0.075 } },
  { k: 'balanced', name: 'Balanced', w: { arbitrage: 0.36, gold: 0.16, large: 0.16, mid: 0.16, small: 0.16 } },
  { k: 'aggressive', name: 'Aggressive', w: { arbitrage: 0.2, gold: 0.2, large: 0.2, mid: 0.2, small: 0.2 } },
  { k: 'quadrant', name: 'Quadrant', w: { arbitrage: 0, gold: 0.25, large: 0.25, mid: 0.25, small: 0.25 } },
  { k: 'equity', name: 'Equity only', w: { arbitrage: 0, gold: 0, large: 0.333, mid: 0.333, small: 0.334 } },
];
/** your own mixes get these line colours, in order (never reused while on the chart) */
const CUSTOM_COLOURS = ['#6250d6', '#e34948', '#1baf7a', '#eda100', '#e87ba4', '#5a5f78'];
const PART_COLOUR: Record<string, string> = { arbitrage: '#98a0b8', gold: '#eda100', large: '#387ed1', mid: '#eb6834', small: '#1baf7a' };
const PART_NAME: Record<string, string> = { arbitrage: 'Arbitrage', gold: 'Gold', large: 'Nifty 50', mid: 'Mid cap', small: 'Small cap' };
const PARTS = ['arbitrage', 'gold', 'large', 'mid', 'small'];
const GROWTH = ['gold', 'large', 'mid', 'small'];
/** villa part → the item whose series moves it */
const PART_OF: Record<string, string> = { arbitrage: 'arbitrage', gold: 'gold', large: 'nifty50', mid: 'mid', small: 'small' };
/** a heat colour reaches full strength at this move (%, or bp for the yield) — per kind, per range */
const CAPS: Record<string, Partial<Record<IRange, number>>> = {
  index: { '1d': 1.5, '1w': 3.5, '1m': 6, '3m': 10, 'ytd': 20, '1y': 25, '3y': 60, '5y': 100, '10y': 250, '15y': 500 },
  arbitrage: { '1d': 0.1, '1w': 0.3, '1m': 0.8, '3m': 2, 'ytd': 6, '1y': 8, '3y': 22, '5y': 40, '10y': 90, '15y': 150 },
  fx: { '1d': 0.5, '1w': 1, '1m': 2, '3m': 4, 'ytd': 8, '1y': 10, '3y': 20, '5y': 30, '10y': 60, '15y': 90 },
  yield: { '1d': 8, '1w': 18, '1m': 35, '3m': 60, 'ytd': 100, '1y': 120, '3y': 250, '5y': 350, '10y': 400, '15y': 450 },
  villa: { '1d': 1, '1w': 2.5, '1m': 5, '3m': 8, 'ytd': 15, '1y': 20, '3y': 50, '5y': 90, '10y': 220, '15y': 450 },
};
const DAY = 86400;
const addYears = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); };
const PAD = { l: 44, t: 14, b: 26 };
const DEFAULT_LINES = ['villa:balanced', 'nifty50', 'gold'];
/** benchmarks built here from the board's own series (no feed of their own): key → part weights.
 *  Replayed like a villa's growth engine — back to the weights at every year end. */
const BLENDS: { key: string; name: string; short: string; about: string; w: Weights; from: Record<string, string> }[] = [
  { key: 'lms_eq', name: 'Large · Mid · Small, ⅓ each', short: 'Equal L·M·S', w: { large: 1 / 3, mid: 1 / 3, small: 1 / 3 },
    from: { large: 'n100', mid: 'mid', small: 'small' },
    about: 'Large, mid and small cap equally: ⅓ Nifty 100 + ⅓ Midcap 150 + ⅓ Smallcap 250, back to ⅓ each every year end' },
];
/** a mix of your own: any indices (item keys) → share, always adding to 1 */
interface Custom { key: string; name: string; weights: Weights; v?: number; }
const MAX_IN_MIX = 10;
/** templates for your own mixes, in item keys */
const TEMPLATES: { k: string; name: string; w: Weights }[] = [
  { k: 'quadrant', name: 'Quadrant', w: { gold: 0.25, nifty50: 0.25, mid: 0.25, small: 0.25 } },
  { k: 'lms', name: 'Equal L·M·S', w: { n100: 1 / 3, mid: 1 / 3, small: 1 / 3 } },
  { k: 'm502525', name: '50 · 25 · 25', w: { n100: 0.5, mid: 0.25, small: 0.25 } },
  { k: 'conservative', name: 'Conservative', w: { arbitrage: 0.7, gold: 0.075, nifty50: 0.075, mid: 0.075, small: 0.075 } },
  { k: 'balanced', name: 'Balanced', w: { arbitrage: 0.36, gold: 0.16, nifty50: 0.16, mid: 0.16, small: 0.16 } },
  { k: 'aggressive', name: 'Aggressive', w: { arbitrage: 0.2, gold: 0.2, nifty50: 0.2, mid: 0.2, small: 0.2 } },
];
/** colours for indices that have no fixed style, in catalogue order */
const INDEX_COLOURS = ['#0e9bb0', '#c2410c', '#7c3aed', '#0f766e', '#be185d', '#4d7c0f', '#1d4ed8', '#b45309', '#9333ea', '#047857', '#dc2626', '#475569'];
const PICK_GROUPS = ['All', 'Broad market', 'Size', 'Sectors', 'Themes', 'Strategy', 'Commodities', 'World'];
/** the chip palette under the chart, in order — every line the chart can draw */
const CHIP_GROUPS: { name: string; keys: string[] }[] = [
  { name: 'Benchmarks', keys: ['lms_eq', 'nifty50', 'n100', 'mid', 'small', 'n500'] },
  { name: 'Gold · arbitrage', keys: ['gold', 'arbitrage'] },
  { name: 'World', keys: ['rupee', 'sp500'] },
];

/** The villa over the window: ₹1 split by the weights at the start, each part moving with its %
 *  series (carried between its points), the growth engine reset to its split at every year end
 *  inside the window — as the villas do. Pre-tax. Within a day it is the weighted sum of the parts. */
function replay(weights: Weights, parts: Record<string, IItem | undefined>): IBasket {
  const used = Object.keys(weights).filter((p) => (weights[p] ?? 0) > 0);
  if (!used.length || used.some((p) => !parts[p]?.ok || !parts[p]!.t.length)) return { ok: false, pct: null, day_pct: null, t: [], v: [] };
  const ts = [...new Set(used.flatMap((p) => parts[p]!.t))].sort((a, b) => a - b);
  const growth = used.filter((p) => p !== 'arbitrage');
  const gw = growth.reduce((a, p) => a + weights[p], 0) || 1;
  const idx: Record<string, number> = {}, lvl: Record<string, number> = {}, units: Record<string, number> = {};
  for (const p of used) { idx[p] = 0; lvl[p] = 1; units[p] = weights[p]; }
  const out: number[] = [];
  let resets = 0;
  const ym = (t: number) => { const d = new Date(t * 1000); return [d.getUTCFullYear(), d.getUTCMonth()]; };
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    for (const p of used) { const it = parts[p]!; while (idx[p] < it.t.length && it.t[idx[p]] <= t) { lvl[p] = 1 + it.v[idx[p]] / 100; idx[p]++; } }
    out.push(+((used.reduce((a, p) => a + units[p] * lvl[p], 0) - 1) * 100).toFixed(4));
    if (k > 0 && k + 1 < ts.length && growth.length) {
      const [y, m] = ym(t), [ny] = ym(ts[k + 1]);
      if (m === 11 && ny > y) { const gv = growth.reduce((a, p) => a + units[p] * lvl[p], 0); for (const p of growth) units[p] = gv * (weights[p] / gw) / lvl[p]; resets++; }
    }
  }
  return { ok: true, pct: out[out.length - 1], resets, day_pct: used.reduce((a, p) => a + weights[p] * (parts[p]!.day_pct ?? 0), 0), t: ts, v: out };
}

/** a smooth monotone path through the points (no overshoot), or straight segments for long series */
function pathOf(xs: number[], ys: number[]): string {
  const n = xs.length; if (!n) return '';
  if (n > 400 || n < 3) { let p = ''; for (let i = 0; i < n; i++) p += (i ? 'L' : 'M') + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1); return p; }
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { const dx = xs[i + 1] - xs[i] || 1e-6; d.push((ys[i + 1] - ys[i]) / dx); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const tt = 3 / Math.sqrt(s); m[i] = tt * a * d[i]; m[i + 1] = tt * b * d[i]; } }
  let p = 'M' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    p += `C${(xs[i] + dx).toFixed(1)} ${(ys[i] + m[i] * dx).toFixed(1)} ${(xs[i + 1] - dx).toFixed(1)} ${(ys[i + 1] - m[i + 1] * dx).toFixed(1)} ${xs[i + 1].toFixed(1)} ${ys[i + 1].toFixed(1)}`;
  }
  return p;
}

@Component({
  selector: 'app-global-markets',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-markets.component.html',
  styleUrl: './global-markets.component.scss',
})
export class GlobalMarketsComponent implements OnInit, OnDestroy {
  private api = inject(AdminService);
  readonly RANGES = RANGES;
  readonly GROWTH = GROWTH;
  readonly PART_COLOUR = PART_COLOUR;
  readonly PART_NAME = PART_NAME;

  readonly board = signal<IndiaBoard | null>(null);
  readonly range = signal<IRange>('1d');
  readonly gold = signal<Gold>('with');
  readonly lines$ = signal<string[]>(DEFAULT_LINES);
  readonly customFrom = signal<string>('');
  readonly customTo = signal<string>('');
  /** the admin's own mixes, by villa key — absent = the configured villa */
  readonly mixes = signal<Record<string, Weights>>({});
  readonly editing = signal<string | null>(null);
  /** your own mixes (Quadrant…), kept on this device */
  readonly customs = signal<Custom[]>([]);
  /** every index a mix can use, and the ones fetched for the current range (beyond the board's own) */
  readonly catalog = signal<ICatalogItem[]>([]);
  readonly extraItems = signal<Map<string, IItem>>(new Map());
  readonly extraBusy = signal(false);
  private extraSig = '';
  private extraSeq = 0;
  /** the index picker inside the mix sheet */
  readonly pickOpen = signal(false);
  readonly pickQ = signal('');
  readonly pickGroup = signal('All');
  readonly PICK_GROUPS = PICK_GROUPS;
  readonly TEMPLATES = TEMPLATES;
  readonly MAX_IN_MIX = MAX_IN_MIX;
  readonly PRESETS = PRESETS;
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly now = signal(Date.now());
  readonly hover = signal<number | null>(null);
  readonly note = signal('');
  readonly infoOpen = signal(false);
  readonly box = signal({ w: 720, h: 360 });

  @ViewChild('plot') set plotEl(el: ElementRef<HTMLElement> | undefined) {
    this.ro?.disconnect(); this.ro = undefined;
    const node = el?.nativeElement;
    if (!node || typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver((es) => {
      const r = es[0]?.contentRect; if (!r) return;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w && h && (w !== this.box().w || h !== this.box().h)) this.box.set({ w, h });
    });
    this.ro.observe(node);
  }
  private ro?: ResizeObserver;
  private timer?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;
  private noteT?: ReturnType<typeof setTimeout>;
  private customT?: ReturnType<typeof setTimeout>;
  private seq = 0;

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (RANGES.some((r) => r.k === s.range)) this.range.set(s.range);
      if (s.gold === 'with' || s.gold === 'without') this.gold.set(s.gold);
      if (Array.isArray(s.lines) && s.lines.length) this.lines$.set(s.lines.filter((k: unknown) => typeof k === 'string' && k.length < 40));
      if (typeof s.from === 'string') this.customFrom.set(s.from);
      if (typeof s.to === 'string') this.customTo.set(s.to);
      if (s.mixes && typeof s.mixes === 'object') this.mixes.set(s.mixes);
      if (Array.isArray(s.customs)) this.customs.set(s.customs
        .filter((c: { key?: unknown; weights?: unknown }) => typeof c?.key === 'string' && c.weights && typeof c.weights === 'object')
        .map((c: Custom) => c.v === 2 ? c : { ...c, v: 2, weights: this.toItemKeys(c.weights) }));
    } catch { /* first visit */ }
    this.load();
    this.api.indiaCatalogue().subscribe({ next: (r) => this.catalog.set(r.items ?? []), error: () => {} });
    this.timer = setInterval(() => this.load(true), 60_000);
    this.clock = setInterval(() => this.now.set(Date.now()), 15_000);
  }
  ngOnDestroy(): void { clearInterval(this.timer); clearInterval(this.clock); clearTimeout(this.noteT); clearTimeout(this.customT); this.ro?.disconnect(); }
  @HostListener('document:visibilitychange')
  onVis(): void { if (document.visibilityState === 'visible') this.load(true); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.hover.set(null); this.infoOpen.set(false); if (this.pickOpen()) { this.pickOpen.set(false); return; } this.editing.set(null); }
  @HostListener('document:pointerdown', ['$event'])
  onDoc(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    if (this.infoOpen() && !t?.closest?.('.pf-info')) this.infoOpen.set(false);
  }

  private remember(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ range: this.range(), gold: this.gold(), lines: this.lines$(), from: this.customFrom(), to: this.customTo(), mixes: this.mixes(), customs: this.customs() }));
    } catch { /* private mode */ }
  }
  load(quiet = false): void {
    const rng = this.range(), id = ++this.seq;
    if (!quiet) this.busy.set(true);
    this.api.indiaBoard(rng, this.customFrom() || undefined, this.customTo() || undefined).subscribe({
      next: (b) => { if (id !== this.seq) return; this.board.set(b); this.busy.set(false); this.error.set(''); this.now.set(Date.now()); this.loadExtras(quiet); },
      error: () => { if (id !== this.seq) return; this.busy.set(false); if (!this.board()) this.error.set('Could not reach the markets feed.'); },
    });
  }
  /** the catalogue indices your mixes (and the chart) use that the board doesn't carry */
  private neededExtras(): string[] {
    const board = new Set((this.board()?.items ?? []).map((i) => i.key));
    const want = new Set<string>();
    for (const c of this.customs()) for (const [k, w] of Object.entries(c.weights)) if (w > 0) want.add(k);
    for (const k of this.lines$()) if (!k.startsWith('villa:')) want.add(k);
    return [...want].filter((k) => !board.has(k) && !BLENDS.some((b) => b.key === k)).sort();
  }
  /** fetch them for the current range (only when the set or the range changed, or on the minute refresh) */
  loadExtras(refresh = false): void {
    const keys = this.neededExtras();
    const sig = [this.range(), this.customFrom(), this.customTo(), keys.join(',')].join('|');
    if (!keys.length) { this.extraSig = sig; return; }
    if (sig === this.extraSig && !refresh) return;
    const fresh = sig !== this.extraSig;
    this.extraSig = sig;
    const id = ++this.extraSeq;
    if (fresh) this.extraBusy.set(true);
    this.api.indiaExtra(keys, this.range(), this.customFrom() || undefined, this.customTo() || undefined).subscribe({
      next: (r) => { if (id !== this.extraSeq) return; this.extraItems.set(new Map((r.items ?? []).map((i) => [i.key, i]))); this.extraBusy.set(false); },
      error: () => { if (id === this.extraSeq) this.extraBusy.set(false); },
    });
  }
  setRange(k: IRange): void {
    if (k === this.range()) return;
    this.range.set(k); this.hover.set(null); this.extraItems.set(new Map());
    if (k === 'custom' && !this.customFrom()) {
      const end = this.board()?.session || new Date().toISOString().slice(0, 10);
      this.customTo.set(end); this.customFrom.set(addYears(end, -3));
    }
    this.remember(); this.load();
  }
  readonly maxDay = computed(() => this.board()?.session || new Date().toISOString().slice(0, 10));
  readonly minDay = computed(() => addYears(this.maxDay(), -(this.board()?.max_years ?? 15)));
  setCustom(which: 'from' | 'to', value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    if (which === 'from') this.customFrom.set(value); else this.customTo.set(value);
    this.remember();
    clearTimeout(this.customT);
    this.customT = setTimeout(() => this.load(), 350);
  }
  setGold(g: Gold): void { this.gold.set(g); this.remember(); }
  toggle(key: string): void {
    const cur = this.lines$();
    if (cur.includes(key)) this.lines$.set(cur.filter((k) => k !== key));
    else if (cur.length >= MAX_LINES) { this.say(`Up to ${MAX_LINES} lines — take one off first`); return; }
    else this.lines$.set([...cur, key]);
    this.remember(); this.loadExtras();
  }
  isOn(key: string): boolean { return this.lines$().includes(key); }
  /** a heat tile tapped: toggle its line; on a phone the chart is off-screen, so say what happened and bring the chart up */
  tapTile(t: { key: string; short: string; chartable: boolean }): void {
    if (!t.chartable) { this.say(`${t.short} is shown here only`); return; }
    const was = this.isOn(t.key);
    this.toggle(t.key);
    const now = this.isOn(t.key);
    if (now === was) return;                                   // hit the line limit — toggle() already said so
    if (window.innerWidth <= 900) {
      this.say(now ? `${t.short} on the chart` : `${t.short} off the chart`);
      if (now) this.host.nativeElement.querySelector('.pf-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  private say(msg: string): void { this.note.set(msg); clearTimeout(this.noteT); this.noteT = setTimeout(() => this.note.set(''), 2600); }

  // ── what the page shows ────────────────────────────────────────────────────
  readonly rangeMeta = computed(() => RANGES.find((r) => r.k === this.range()) ?? RANGES[0]);
  readonly rangeLong = computed(() => {
    const w = this.board()?.window;
    if (this.range() !== 'custom' || !w) return this.rangeMeta().long;
    const f = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
    return `${f(w.start)} – ${f(w.end)}`;
  });
  private capKey = computed<IRange>(() => {
    const r = this.range(); if (r !== 'custom') return r;
    const w = this.board()?.window; if (!w) return '1y';
    const yrs = (new Date(w.end).getTime() - new Date(w.start).getTime()) / (365.25 * DAY * 1000);
    let best: IRange = '1y', gap = Infinity;
    for (const [k, y] of CAP_SPANS) { const g = Math.abs(Math.log(yrs / y)); if (g < gap) { gap = g; best = k; } }
    return best;
  });
  readonly isIntraday = computed(() => this.range() === '1d');
  private readonly rawItems = computed(() => {
    const m = new Map((this.board()?.items ?? []).map((i) => [i.key, i]));
    for (const [k, i] of this.extraItems()) if (!m.has(k)) m.set(k, i);
    return m;
  });
  /** the board's items plus the blends built from them (Equal L·M·S…) */
  readonly items = computed(() => {
    const m = new Map(this.rawItems());
    for (const bl of BLENDS) {
      const parts: Record<string, IItem | undefined> = {};
      for (const [p, k] of Object.entries(bl.from)) parts[p] = m.get(k);
      const r = replay(bl.w, parts), any = Object.values(parts)[0];
      m.set(bl.key, { key: bl.key, name: bl.name, short: bl.short, group: 'India', kind: 'index', about: bl.about, ok: r.ok,
        last: null, prev: null, base: null, session: any?.session ?? null, time: any?.time ?? null,
        pct: r.pct, day_pct: r.day_pct, source: any?.source ?? 'tri', t: r.t, v: r.v });
    }
    return m;
  });
  readonly villas = computed<IVilla[]>(() => {
    const none: IBasket = { ok: false, pct: null, day_pct: null, t: [], v: [] };
    return [...(this.board()?.villas ?? []),
      ...this.customs().map((c) => ({ key: c.key, name: c.name, risk: 0, risk_name: 'Yours', weights: c.weights, weights_no_gold: c.weights, with_gold: none, no_gold: none }))];
  });
  readonly sessionLabel = computed(() => {
    const s = this.board()?.session; if (!s) return '';
    return new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  });
  readonly nseOpen = computed(() => !!this.board()?.nse?.open);
  readonly nseState = computed(() => {
    const n = this.board()?.nse; if (!n) return '';
    return n.open ? `Live · ${n.time ?? ''}`.trim() : 'Closed';
  });
  readonly ago = computed(() => {
    const t = this.board()?.as_of; if (!t) return '';
    const s = Math.max(0, Math.round(this.now() / 1000 - t));
    return s < 45 ? 'just now' : s < 90 ? '1 min ago' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  });
  readonly kpis = computed(() => ['nifty50', 'n500', 'gold', 'arbitrage', 'rupee', 'us10y', 'sp500']
    .map((k) => this.items().get(k)).filter((i): i is IItem => !!i && i.ok));
  readonly infoText = computed(() => {
    const b = this.board(); if (!b?.sources) return '';
    return this.range() === '1d' || this.range() === '1w' ? b.sources.intraday : b.sources.daily;
  });
  arrow(v: number | null): string { return v === null ? '' : v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '•'; }

  // ── villas: mix, gold, replay ─────────────────────────────────────────────
  mixOf(v: IVilla): Weights { return this.mixes()[v.key] ?? v.weights; }
  isCustom(v: IVilla): boolean { return !!this.mixes()[v.key]; }
  private withGold(w: Weights, gold: boolean): Weights {
    if (gold) return w;
    const g = w['gold'] ?? 0;
    return { ...w, gold: 0, large: (w['large'] ?? 0) + g / 3, mid: (w['mid'] ?? 0) + g / 3, small: (w['small'] ?? 0) + g / 3 };
  }
  /** every villa replayed from the parts, both ways, for the current mix */
  private villaSeries = computed(() => {
    const items = this.items();
    const parts: Record<string, IItem | undefined> = {};
    for (const p of PARTS) parts[p] = items.get(PART_OF[p]);
    const out: Record<string, { with: IBasket; without: IBasket }> = {};
    for (const v of this.villas()) {
      const w = this.mixOf(v);
      if (this.isYours(v)) {
        // your own mix: any indices, held as you set them (the gold switch is for the villas)
        const mine: Record<string, IItem | undefined> = {};
        for (const k of Object.keys(w)) mine[k] = items.get(k);
        const r = replay(w, mine);
        out[v.key] = { with: r, without: r };
      } else out[v.key] = { with: replay(this.withGold(w, true), parts), without: replay(this.withGold(w, false), parts) };
    }
    return out;
  });
  basket(v: IVilla): IBasket { const s = this.villaSeries()[v.key]; return (this.gold() === 'with' ? s?.with : s?.without) ?? v.with_gold; }
  other(v: IVilla): IBasket { const s = this.villaSeries()[v.key]; return (this.gold() === 'with' ? s?.without : s?.with) ?? v.no_gold; }
  weights(v: IVilla): { p: string; w: number; c: string; name: string }[] {
    if (this.isYours(v)) return Object.entries(this.mixOf(v)).filter(([, x]) => x > 0.0001).map(([k, x]) => ({ p: k, w: x, c: this.colourOf(k), name: this.nameOf(k) }));
    const w = this.withGold(this.mixOf(v), this.gold() === 'with');
    return PARTS.filter((p) => (w[p] ?? 0) > 0.0001).map((p) => ({ p, w: w[p], c: PART_COLOUR[p], name: PART_NAME[p] }));
  }
  /** ── the mix sheet: growth parts in 2.5-point steps, arbitrage takes whatever is left ── */
  readonly editVilla = computed(() => this.villas().find((v) => v.key === this.editing()) ?? null);
  /** one of your own mixes (not a configured villa — 'conservative' also starts with a c) */
  isYours(v: IVilla): boolean { return this.customs().some((c) => c.key === v.key); }
  openEdit(v: IVilla, ev?: Event): void { ev?.stopPropagation(); this.editing.set(v.key); }
  closeEdit(): void { this.editing.set(null); this.pickOpen.set(false); }
  partPct(v: IVilla, p: string): number { return Math.round((this.mixOf(v)[p] ?? 0) * 1000) / 10; }
  private writeMix(v: IVilla, w: Weights): void {
    const clean: Weights = {};
    for (const p of GROWTH) clean[p] = Math.round(Math.max(0, w[p] ?? 0) * 1000) / 1000;
    clean['arbitrage'] = Math.max(0, Math.round((1 - GROWTH.reduce((a, q) => a + clean[q], 0)) * 1000) / 1000);
    if (this.isYours(v)) this.customs.set(this.customs().map((c) => c.key === v.key ? { ...c, weights: clean } : c));
    else this.mixes.set({ ...this.mixes(), [v.key]: clean });
    this.remember();
  }
  setPart(v: IVilla, p: string, raw: string | number): void {
    const cur = { ...this.mixOf(v) };
    let val = Math.max(0, Math.min(100, Number(raw) || 0)) / 100;
    const others = GROWTH.filter((q) => q !== p).reduce((a, q) => a + (cur[q] ?? 0), 0);
    if (others + val > 1) val = 1 - others;                 // the growth engine can't exceed the whole
    cur[p] = val;
    this.writeMix(v, cur);
  }
  stepPart(v: IVilla, p: string, d: number): void { this.setPart(v, p, Math.round((this.partPct(v, p) + d) / 2.5) * 2.5); }
  applyPreset(v: IVilla, k: string): void { const pr = PRESETS.find((x) => x.k === k); if (pr) this.writeMix(v, pr.w); }
  /** which preset the current mix is (to light its chip) */
  presetOf(v: IVilla): string | null {
    const w = this.mixOf(v);
    return PRESETS.find((pr) => PARTS.every((p) => Math.abs((pr.w[p] ?? 0) - (w[p] ?? 0)) < 0.002))?.k ?? null;
  }
  resetMix(v: IVilla): void { const m = { ...this.mixes() }; delete m[v.key]; this.mixes.set(m); this.remember(); }
  rename(v: IVilla, name: string): void {
    const n = name.trim().slice(0, 24) || 'My mix';
    this.customs.set(this.customs().map((c) => c.key === v.key ? { ...c, name: n } : c)); this.remember();
  }
  /** + Add: a new mix of your own (starts as Quadrant), drawn on the chart, editor open */
  addCustom(): void {
    if (this.customs().length >= CUSTOM_COLOURS.length) { this.say('Up to 6 of your own'); return; }
    const key = 'c' + Date.now().toString(36);
    const n = this.customs().filter((c) => c.name.startsWith('Quadrant')).length;
    this.customs.set([...this.customs(), { key, name: n ? `Quadrant ${n + 1}` : 'Quadrant', weights: { ...TEMPLATES[0].w }, v: 2 }]);
    if (!this.isOn('villa:' + key)) this.toggle('villa:' + key);
    this.remember();
    this.editing.set(key);
  }
  removeCustom(v: IVilla): void {
    this.customs.set(this.customs().filter((c) => c.key !== v.key));
    this.lines$.set(this.lines$().filter((k) => k !== 'villa:' + v.key));
    this.editing.set(null); this.remember();
  }
  // ── your own mix: any index, shares always add to 100% ──────────────────
  private toItemKeys(w: Weights): Weights {
    const out: Weights = {};
    for (const [p, x] of Object.entries(w)) { const k = PART_OF[p] ?? p; out[k] = (out[k] ?? 0) + (+x || 0); }
    for (const k of Object.keys(out)) if (out[k] <= 0) delete out[k];
    return out;
  }
  private cat = computed(() => new Map(this.catalog().map((c, i) => [c.key, { ...c, i }])));
  nameOf(k: string): string { return this.cat().get(k)?.short ?? this.items().get(k)?.short ?? k; }
  fullNameOf(k: string): string { return this.cat().get(k)?.name ?? this.items().get(k)?.name ?? k; }
  groupOf(k: string): string { return this.cat().get(k)?.group ?? ''; }
  colourOf(k: string): string {
    if (STYLE[k]) return STYLE[k].c;
    const i = this.cat().get(k)?.i ?? [...k].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return INDEX_COLOURS[i % INDEX_COLOURS.length];
  }
  /** shares in, rounded to 0.1 pt, the rounding left over put on the biggest so they add to exactly 100 */
  private writeYours(v: IVilla, w: Weights): void {
    const keys = Object.keys(w).filter((k) => w[k] > 1e-9);
    const tot = keys.reduce((a, k) => a + w[k], 0) || 1;
    const out: Weights = {};
    for (const k of keys) out[k] = Math.round((w[k] / tot) * 1000) / 1000;
    const big = keys.reduce((a, k) => (out[k] > (out[a] ?? -1) ? k : a), keys[0]);
    if (big) out[big] = Math.round((out[big] + 1 - keys.reduce((a, k) => a + out[k], 0)) * 1000) / 1000;
    this.customs.set(this.customs().map((c) => c.key === v.key ? { ...c, weights: out, v: 2 } : c));
    this.remember(); this.loadExtras();
  }
  yourRows(v: IVilla): { key: string; name: string; full: string; group: string; pct: number; colour: string; ok: boolean }[] {
    return Object.entries(this.mixOf(v)).map(([k, x]) => ({ key: k, name: this.nameOf(k), full: this.fullNameOf(k), group: this.groupOf(k),
      pct: Math.round(x * 1000) / 10, colour: this.colourOf(k), ok: !!this.items().get(k)?.ok }));
  }
  /** one share changed: the others give or take in proportion, so the mix stays at 100% */
  setShare(v: IVilla, k: string, raw: string | number): void {
    const w = { ...this.mixOf(v) };
    const others = Object.keys(w).filter((x) => x !== k);
    if (!others.length) { this.writeYours(v, { [k]: 1 }); return; }
    const val = Math.max(0, Math.min(100, Number(raw) || 0)) / 100;
    const rest = others.reduce((a, x) => a + w[x], 0);
    for (const x of others) w[x] = rest > 1e-9 ? w[x] * (1 - val) / rest : (1 - val) / others.length;
    w[k] = val;
    // keep a zero row on the list (it is still in the mix, at 0%) — writeYours drops only true zeros of removed rows
    this.customs.set(this.customs().map((c) => c.key === v.key ? { ...c, weights: this.round100(w, k), v: 2 } : c));
    this.remember();
  }
  /** rounded to 0.1 pt; the rounding left over goes on the biggest share other than the one being set */
  private round100(w: Weights, keep?: string): Weights {
    const keys = Object.keys(w), out: Weights = {};
    for (const k of keys) out[k] = Math.max(0, Math.round(w[k] * 1000) / 1000);
    const pool = keys.filter((k) => k !== keep && out[k] > 0);
    const big = (pool.length ? pool : keys).reduce((a, k) => (out[k] > (out[a] ?? -1) ? k : a), (pool.length ? pool : keys)[0]);
    if (big) out[big] = Math.round((out[big] + 1 - keys.reduce((a, k) => a + out[k], 0)) * 1000) / 1000;
    return out;
  }
  stepShare(v: IVilla, k: string, d: number): void { this.setShare(v, k, Math.round(((this.mixOf(v)[k] ?? 0) * 100 + d) / 2.5) * 2.5); }
  inMix(v: IVilla, k: string): boolean { return k in this.mixOf(v); }
  /** add an index: it takes an equal share, the rest shrink in proportion */
  addIndex(v: IVilla, k: string): void {
    const w = { ...this.mixOf(v) };
    if (k in w) { this.removeIndex(v, k); return; }
    const n = Object.keys(w).length;
    if (n >= MAX_IN_MIX) { this.say(`Up to ${MAX_IN_MIX} in one mix`); return; }
    for (const x of Object.keys(w)) w[x] = w[x] * n / (n + 1);
    w[k] = n ? 1 / (n + 1) : 1;
    this.customs.set(this.customs().map((c) => c.key === v.key ? { ...c, weights: this.round100(w), v: 2 } : c));
    this.remember(); this.loadExtras();
  }
  removeIndex(v: IVilla, k: string): void {
    const w = { ...this.mixOf(v) }; delete w[k];
    if (!Object.keys(w).length) { this.say('A mix needs at least one index'); return; }
    const tot = Object.values(w).reduce((a, x) => a + x, 0);
    if (tot <= 1e-9) for (const x of Object.keys(w)) w[x] = 1;
    this.writeYours(v, w);
  }
  evenSplit(v: IVilla): void { const w: Weights = {}; for (const k of Object.keys(this.mixOf(v))) w[k] = 1; this.writeYours(v, w); }
  applyTemplate(v: IVilla, k: string): void { const t = TEMPLATES.find((x) => x.k === k); if (t) this.writeYours(v, { ...t.w }); }
  templateOf(v: IVilla): string | null {
    const w = this.mixOf(v);
    return TEMPLATES.find((t) => Object.keys({ ...t.w, ...w }).every((k) => Math.abs((t.w[k] ?? 0) - (w[k] ?? 0)) < 0.002))?.k ?? null;
  }
  openPicker(): void { this.pickOpen.set(true); this.pickQ.set(''); setTimeout(() => (this.host.nativeElement.querySelector('.pk-q') as HTMLInputElement | null)?.focus(), 30); }
  readonly pickList = computed(() => {
    const q = this.pickQ().trim().toLowerCase(), g = this.pickGroup();
    const hit = this.catalog().filter((c) => (g === 'All' || c.group === g) && (!q || c.name.toLowerCase().includes(q) || c.short.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)));
    const out: { name: string; items: ICatalogItem[] }[] = [];
    for (const c of hit) { let grp = out.find((x) => x.name === c.group); if (!grp) out.push(grp = { name: c.group, items: [] }); grp.items.push(c); }
    return out;
  });
  /** a line style for any villa: the configured three are fixed, yours take the next free colour */
  lineStyle(key: string): { c: string; dash?: string; w?: number } {
    if (STYLE[key]) return STYLE[key];
    const i = this.customs().findIndex((c) => 'villa:' + c.key === key);
    return { c: CUSTOM_COLOURS[(i < 0 ? 0 : i) % CUSTOM_COLOURS.length], w: 2.4 };
  }

  // ── heat ──────────────────────────────────────────────────────────────────
  readonly groups = computed(() => {
    const b = this.board(); if (!b) return [];
    const tile = (i: IItem): Tile => ({ key: i.key, name: i.name, short: i.short, about: i.about, kind: i.kind, pct: i.pct, last: i.last, chartable: i.kind !== 'yield' && i.ok });
    const by = (keys: string[]) => keys.map((k) => this.items().get(k)).filter((i): i is IItem => !!i).map(tile);
    return [
      { name: 'India', tiles: by(['nifty50', 'n100', 'mid', 'small', 'n500', 'lms_eq']) },
      { name: 'Gold · arbitrage', tiles: by(['gold', 'arbitrage']) },
      { name: 'World', tiles: by(['rupee', 'us10y', 'sp500']) },
    ];
  });
  private cap(kind: string): number { return (CAPS[kind] ?? CAPS['index'])[this.capKey()] ?? 25; }
  private strength(v: number | null, kind: string): number {
    if (v === null || !isFinite(v)) return 0;
    const x = kind === 'yield' ? v * 100 : v;
    return Math.min(1, Math.abs(x) / this.cap(kind));
  }
  heat(v: number | null, kind: string): string {
    const f = this.strength(v, kind);
    if (f < 0.03) return 'var(--nw-card2)';
    return `color-mix(in srgb, var(${v! > 0 ? '--nw-pos' : '--nw-neg'}) ${Math.round(10 + f * 82)}%, #fff)`;
  }
  /** white text once the tile is deep enough */
  deep(v: number | null, kind: string): boolean { return this.strength(v, kind) > 0.48; }
  tone(v: number | null): 'up' | 'down' | 'flat' { return v === null ? 'flat' : v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'flat'; }

  // ── formatting ────────────────────────────────────────────────────────────
  pct(v: number | null, kind: IKind | 'villa' = 'index', digits?: number): string {
    if (v === null || !isFinite(v)) return '—';
    if (kind === 'yield') { const bp = v * 100; return (bp > 0 ? '+' : bp < 0 ? '−' : '') + Math.abs(bp).toFixed(Math.abs(bp) < 10 ? 1 : 0) + ' bp'; }
    const short = this.range() === '1d' || this.range() === '1w';
    const d = digits ?? (Math.abs(v) >= 100 ? 0 : short ? 2 : 1);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  }
  level(t: Tile | IItem): string {
    if (t.key === 'lms_eq') return '⅓ · ⅓ · ⅓';
    const v = t.last; if (v === null || v === undefined) return '—';
    switch (t.kind) {
      case 'gold': case 'fx': return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'yield': return v.toFixed(2) + '%';
      case 'arbitrage': return v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
      default: return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }
  }
  styleOf(key: string) { return key.startsWith('villa:') ? this.lineStyle(key) : (STYLE[key] ?? { c: this.colourOf(key) }); }

  // ── the chart ─────────────────────────────────────────────────────────────
  readonly lines = computed<Line[]>(() => {
    const b = this.board(); if (!b) return [];
    const out: Line[] = [];
    for (const key of this.lines$()) {
      const st = key.startsWith('villa:') ? this.lineStyle(key) : (STYLE[key] ?? (this.items().has(key) ? { c: this.colourOf(key), w: 1.8 } : null)); if (!st) continue;
      if (key.startsWith('villa:')) {
        const v = this.villas().find((x) => 'villa:' + x.key === key); if (!v) continue;
        const bk = this.basket(v); if (!bk.ok || bk.t.length < 2) continue;
        out.push({ key, name: this.isYours(v) ? v.name : `${v.name} villa`, short: v.name, colour: st.c, dash: st.dash ?? null, width: st.w ?? 2, t: bk.t, v: bk.v, villa: true });
      } else {
        const i = this.items().get(key); if (!i || !i.ok || i.t.length < 2 || i.kind === 'yield') continue;
        // an index with no intraday bars is a straight line to its live move — dotted, so it doesn't pass for a path
        const approx = !STYLE[key] && i.t.length <= 2;
        out.push({ key, name: i.name, short: i.short, colour: st.c, dash: st.dash ?? (approx ? '2 5' : null), width: st.w ?? 2, t: i.t, v: i.v, villa: false });
      }
    }
    return out;
  });
  readonly endNames = computed(() => this.box().w >= 720);
  readonly padR = computed(() => this.endNames() ? 160 : 78);
  readonly cw = computed(() => Math.max(120, this.box().w - PAD.l - this.padR()));
  readonly ch = computed(() => Math.max(80, this.box().h - PAD.t - PAD.b));
  readonly padL = PAD.l; readonly padT = PAD.t;
  private span = computed(() => {
    const ls = this.lines(); if (!ls.length) return null;
    const t0 = Math.min(...ls.map((l) => l.t[0])), t1 = Math.max(...ls.map((l) => l.t[l.t.length - 1]));
    let lo = 0, hi = 0;
    for (const l of ls) for (const v of l.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.1 || 0.1;
    return { t0, t1: t1 > t0 ? t1 : t0 + 60, lo: lo - pad, hi: hi + pad };
  });
  x(t: number): number { const s = this.span()!; return ((t - s.t0) / (s.t1 - s.t0)) * this.cw(); }
  y(v: number): number { const s = this.span()!; return this.ch() - ((v - s.lo) / (s.hi - s.lo)) * this.ch(); }
  readonly paths = computed(() => {
    if (!this.span()) return [];
    const w = this.cw();
    return this.lines().map((l) => {
      const step = Math.max(1, Math.floor(l.t.length / (w * 1.5)));
      const xs: number[] = [], ys: number[] = [];
      for (let i = 0; i < l.t.length; i += step) { xs.push(this.x(l.t[i])); ys.push(this.y(l.v[i])); }
      const n = l.t.length - 1;
      if (n % step) { xs.push(this.x(l.t[n])); ys.push(this.y(l.v[n])); }
      return { key: l.key, colour: l.colour, dash: l.dash, width: l.width, d: pathOf(xs, ys), villa: l.villa };
    });
  });
  readonly yTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const n = Math.max(3, Math.floor(this.ch() / 70));
    const raw = (s.hi - s.lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((t) => (s.hi - s.lo) / t <= n + 1) ?? 10 * mag;
    const out: { y: number; label: string; zero: boolean }[] = [];
    const dp = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    for (let v = Math.ceil(s.lo / step) * step; v <= s.hi; v += step) {
      const r = +v.toFixed(6);
      out.push({ y: this.y(r), label: (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(dp) + '%', zero: Math.abs(r) < 1e-9 });
    }
    return out;
  });
  readonly xTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const out: { x: number; label: string }[] = [];
    const maxN = Math.max(3, Math.floor(this.cw() / (this.cw() < 420 ? 70 : 96)));
    const spanS = s.t1 - s.t0;
    if (this.range() === '1d' || this.range() === '1w') {
      const hours = spanS / 3600;
      const stepH = this.range() === '1d' ? ([1, 2, 3, 4, 6].find((h) => hours / h <= maxN) ?? 6) : ([6, 12, 24].find((h) => hours / h <= maxN) ?? 24);
      const off = 5.5 * 3600;
      let t = Math.ceil((s.t0 + off) / (stepH * 3600)) * stepH * 3600 - off;
      for (; t <= s.t1; t += stepH * 3600) {
        const d = new Date(t * 1000);
        const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST });
        if (this.range() === '1w' && stepH >= 24 && hm !== '00:00') continue;
        const label = this.range() === '1w' && (hm === '00:00' || stepH >= 24) ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: IST }) : hm;
        out.push({ x: this.x(t), label });
      }
      return out;
    }
    const days = spanS / 86400;
    const stepD = [1, 2, 3, 5, 7, 14, 30, 61, 91, 182, 365, 730, 1095].find((d) => days / d <= maxN) ?? 1826;
    const d0 = new Date(s.t0 * 1000); d0.setUTCHours(12, 0, 0, 0);
    if (stepD >= 365) {
      const stepY = Math.round(stepD / 365);
      const d = new Date(Date.UTC(d0.getUTCFullYear() + 1, 0, 1, 12));
      while (d.getTime() / 1000 <= s.t1) { if (d.getUTCFullYear() % stepY === 0) out.push({ x: this.x(d.getTime() / 1000), label: String(d.getUTCFullYear()) }); d.setUTCFullYear(d.getUTCFullYear() + 1); }
      return out;
    }
    if (stepD >= 30) {
      const d = new Date(d0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
      const stepM = Math.round(stepD / 30);
      while (d.getTime() / 1000 <= s.t1) {
        if (d.getUTCMonth() % stepM === 0) out.push({ x: this.x(d.getTime() / 1000), label: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : '') });
        d.setUTCMonth(d.getUTCMonth() + 1);
      }
      return out;
    }
    const d = new Date(d0); d.setUTCDate(d.getUTCDate() + 1);
    let k = 0;
    while (d.getTime() / 1000 <= s.t1) { if (k % stepD === 0) out.push({ x: this.x(d.getTime() / 1000), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }); d.setUTCDate(d.getUTCDate() + 1); k++; }
    return out;
  });
  /** value pills at the line ends, nudged apart */
  readonly ends = computed(() => {
    if (!this.span()) return [];
    const H = this.ch();
    const ls = this.lines().map((l) => {
      const v = l.v[l.v.length - 1], label = this.pct(v, l.villa ? 'villa' : 'index');
      return { key: l.key, colour: l.colour, name: l.short, label, value: v, y0: this.y(v), y: this.y(v), x: this.x(l.t[l.t.length - 1]), villa: l.villa, w: label.length * 7.2 + 14 };
    }).sort((a, b) => a.y - b.y);
    const gap = Math.min(26, H / Math.max(1, ls.length));
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < gap) ls[i].y = ls[i - 1].y + gap;
    const over = ls.length ? ls[ls.length - 1].y - H : 0;
    if (over > 0) for (const l of ls) l.y -= over;
    for (let i = ls.length - 2; i >= 0; i--) if (ls[i + 1].y - ls[i].y < gap) ls[i].y = ls[i + 1].y - gap;
    return ls;
  });
  onMove(ev: PointerEvent, el: Element): void {
    const s = this.span(); if (!s) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left - PAD.l) / Math.max(1, r.width - PAD.l - this.padR())));
    this.hover.set(Math.round(s.t0 + f * (s.t1 - s.t0)));
  }
  leave(): void { this.hover.set(null); }
  readonly tip = computed(() => {
    const t = this.hover(); if (t === null || !this.span()) return null;
    const rows = this.lines().map((l) => {
      let i = -1; for (let k = 0; k < l.t.length && l.t[k] <= t; k++) i = k;
      return i < 0 ? null : { key: l.key, value: l.v[i], y: this.y(l.v[i]), colour: l.colour };
    }).filter((r): r is NonNullable<typeof r> => !!r);
    return { x: this.x(t), when: this.whenLabel(t), rows };
  });
  private whenLabel(t: number): string {
    const d = new Date(t * 1000);
    return this.range() === '1d' || this.range() === '1w'
      ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST })
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  /** every line the chart can draw, as chips: on = drawn (its colour, live value), off = one tap to add.
   *  The same on/off state lights the villa strip and the heat tiles, so all three always agree. */
  readonly palette = computed(() => {
    const vals = this.chipVals(), on = new Set(this.lines$());
    const chip = (key: string, short: string, pct: number | null, kind: IKind | 'villa') => {
      const st = this.styleOf(key), isOn = on.has(key);
      const v = isOn && vals[key] !== undefined ? vals[key] : pct;
      return { key, short, on: isOn, colour: st.c, dash: !!st.dash, villa: kind === 'villa', val: v, kind };
    };
    const villas = this.villas().map((v) => chip('villa:' + v.key, v.name, this.basket(v).pct, 'villa'));
    const rest = CHIP_GROUPS.map((g) => ({ name: g.name, chips: g.keys.map((k) => this.items().get(k))
      .filter((i): i is IItem => !!i && i.ok && i.t.length > 1).map((i) => chip(i.key, i.short, i.pct, i.kind)) }));
    const shown = new Set(CHIP_GROUPS.flatMap((g) => g.keys));
    const yours = [...new Set(this.customs().flatMap((c) => Object.keys(c.weights)))].filter((k) => !shown.has(k))
      .map((k) => this.items().get(k)).filter((i): i is IItem => !!i && i.ok && i.t.length > 1).map((i) => chip(i.key, i.short, i.pct, i.kind));
    return [{ name: 'Villas', chips: villas }, ...rest, { name: 'In your mixes', chips: yours }].filter((g) => g.chips.length);
  });
  readonly onCount = computed(() => this.lines().length);
  readonly MAX_LINES = MAX_LINES;
  /** the chips: the hovered moment's values, else the latest */
  readonly chipVals = computed(() => {
    const m: Record<string, number> = {};
    const t = this.tip();
    if (t) for (const r of t.rows) m[r.key] = r.value;
    else for (const l of this.lines()) m[l.key] = l.v[l.v.length - 1];
    return m;
  });
  readonly whenShown = computed(() => {
    const t = this.tip(); if (t) return t.when;
    const ls = this.lines(); if (!ls.length) return '';
    return this.whenLabel(Math.max(...ls.map((l) => l.t[l.t.length - 1])));
  });
}
