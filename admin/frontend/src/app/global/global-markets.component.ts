import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';

import { AdminService, IBasket, IItem, IKind, IRange, IVilla, IndiaBoard } from '../admin.service';

/** Markets today — the India board: the three villas (with / without gold), a heat map of the
 *  Indian indices · gold · arbitrage · rupee · US 10-year · S&P 500, and one chart of their
 *  movement over the chosen range (live 5-minute bars for 1D). */

type Gold = 'with' | 'without';
interface Line { key: string; name: string; short: string; colour: string; dash: string | null; width: number; t: number[]; v: number[]; villa: boolean; }
interface Tile {
  key: string; name: string; short: string; about: string; kind: IKind; pct: number | null; day_pct: number | null;
  last: number | null; prev: number | null; high?: number | null; low?: number | null; source: 'live' | 'close'; chartable: boolean; item: IItem;
}

const RANGES: { k: IRange; l: string; long: string }[] = [
  { k: '1d', l: '1D', long: 'today' }, { k: '1w', l: '1W', long: 'this week' }, { k: '1m', l: '1M', long: 'over a month' },
  { k: '3m', l: '3M', long: 'over 3 months' }, { k: 'ytd', l: 'YTD', long: 'this year' }, { k: '1y', l: '1Y', long: 'over a year' },
];
const IST = 'Asia/Kolkata';
const STORE = 'dv_admin_today';
const MAX_LINES = 8;
/** one fixed style per entity — a line keeps its colour however many are drawn. The eight hues
 *  are the validated light categorical palette; entities that share a hue differ by dash. */
const STYLE: Record<string, { c: string; dash?: string; w?: number }> = {
  // the villas are the "you" lines: the accent blue, 2.4 px, told apart by dash
  'villa:balanced': { c: '#387ed1', w: 2.4 }, 'villa:conservative': { c: '#387ed1', dash: '9 5', w: 2.4 }, 'villa:aggressive': { c: '#387ed1', dash: '2 4', w: 2.4 },
  // Nifty 50 is the benchmark line (grey, dashed); the rest keep one fixed hue each
  nifty50: { c: '#98a0b8', dash: '4 3', w: 1.8 }, n100: { c: '#5a5f78', w: 1.8 }, mid: { c: '#eb6834', w: 1.8 }, small: { c: '#1baf7a', w: 1.8 }, n500: { c: '#6250d6', w: 1.8 },
  gold: { c: '#eda100', w: 1.8 }, arbitrage: { c: '#e87ba4', dash: '2 4', w: 1.8 }, usdinr: { c: '#6250d6', dash: '7 5', w: 1.8 }, sp500: { c: '#e34948', w: 1.8 },
};
/** the weights strip inside a villa card — each part in its line's colour */
const PART_COLOUR: Record<string, string> = { arbitrage: '#98a0b8', gold: '#eda100', large: '#387ed1', mid: '#eb6834', small: '#1baf7a' };
const PART_NAME: Record<string, string> = { arbitrage: 'Arbitrage', gold: 'Gold', large: 'Nifty 50', mid: 'Mid cap', small: 'Small cap' };
const PARTS = ['arbitrage', 'gold', 'large', 'mid', 'small'];
/** a heat colour reaches full strength at this move (%, or bp for the yield) — per kind, per range */
const CAPS: Record<string, Record<IRange, number>> = {
  index: { '1d': 2, '1w': 4, '1m': 7, '3m': 10, 'ytd': 20, '1y': 25 },
  arbitrage: { '1d': 0.1, '1w': 0.3, '1m': 0.8, '3m': 2, 'ytd': 6, '1y': 8 },
  fx: { '1d': 0.6, '1w': 1.2, '1m': 2.5, '3m': 4, 'ytd': 8, '1y': 10 },
  yield: { '1d': 10, '1w': 20, '1m': 35, '3m': 60, 'ytd': 100, '1y': 120 },
  villa: { '1d': 1.2, '1w': 2.5, '1m': 5, '3m': 8, 'ytd': 15, '1y': 20 },
};
const PAD = { l: 46, r: 92, t: 12, b: 28 };
const DEFAULT_LINES = ['nifty50', 'mid', 'small', 'gold', 'villa:balanced'];

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
  readonly PARTS = PARTS;
  readonly PART_COLOUR = PART_COLOUR;
  readonly PART_NAME = PART_NAME;

  readonly board = signal<IndiaBoard | null>(null);
  readonly range = signal<IRange>('1d');
  readonly gold = signal<Gold>('with');
  readonly lines$ = signal<string[]>(DEFAULT_LINES);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly now = signal(Date.now());
  readonly hover = signal<number | null>(null);
  readonly note = signal('');
  readonly methodOpen = signal(false);
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
  private seq = 0;

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (RANGES.some((r) => r.k === s.range)) this.range.set(s.range);
      if (s.gold === 'with' || s.gold === 'without') this.gold.set(s.gold);
      if (Array.isArray(s.lines) && s.lines.length) this.lines$.set(s.lines.filter((k: unknown) => typeof k === 'string' && k in STYLE));
    } catch { /* first visit */ }
    this.load();
    this.timer = setInterval(() => this.load(true), 60_000);
    this.clock = setInterval(() => this.now.set(Date.now()), 15_000);
  }
  ngOnDestroy(): void { clearInterval(this.timer); clearInterval(this.clock); clearTimeout(this.noteT); this.ro?.disconnect(); }
  @HostListener('document:visibilitychange')
  onVis(): void { if (document.visibilityState === 'visible') this.load(true); }
  @HostListener('document:keydown.escape')
  onEsc(): void { this.hover.set(null); this.methodOpen.set(false); }
  @HostListener('document:pointerdown', ['$event'])
  onDoc(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    if (this.methodOpen() && !t?.closest?.('.td-method')) this.methodOpen.set(false);
  }

  private remember(): void {
    try { localStorage.setItem(STORE, JSON.stringify({ range: this.range(), gold: this.gold(), lines: this.lines$() })); } catch { /* private mode */ }
  }
  load(quiet = false): void {
    const rng = this.range(), id = ++this.seq;
    if (!quiet) this.busy.set(true);
    this.api.indiaBoard(rng).subscribe({
      next: (b) => {
        if (id !== this.seq) return;                          // an older request answering late
        this.board.set(b); this.busy.set(false); this.error.set(''); this.now.set(Date.now());
      },
      error: () => { if (id !== this.seq) return; this.busy.set(false); if (!this.board()) this.error.set('Could not reach the markets feed.'); },
    });
  }
  setRange(k: IRange): void { if (k === this.range()) return; this.range.set(k); this.hover.set(null); this.remember(); this.load(); }
  setGold(g: Gold): void { this.gold.set(g); this.remember(); }
  toggle(key: string): void {
    const cur = this.lines$();
    if (cur.includes(key)) { this.lines$.set(cur.filter((k) => k !== key)); }
    else if (cur.length >= MAX_LINES) { this.say(`Up to ${MAX_LINES} lines at once — take one off first`); return; }
    else this.lines$.set([...cur, key]);
    this.remember();
  }
  isOn(key: string): boolean { return this.lines$().includes(key); }
  private say(msg: string): void { this.note.set(msg); clearTimeout(this.noteT); this.noteT = setTimeout(() => this.note.set(''), 2600); }

  // ── what the page shows ────────────────────────────────────────────────────
  readonly rangeMeta = computed(() => RANGES.find((r) => r.k === this.range()) ?? RANGES[0]);
  readonly isIntraday = computed(() => this.range() === '1d');
  readonly items = computed(() => new Map((this.board()?.items ?? []).map((i) => [i.key, i])));
  readonly villas = computed(() => this.board()?.villas ?? []);
  readonly sessionLabel = computed(() => {
    const s = this.board()?.session; if (!s) return '';
    return new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  });
  readonly nseState = computed(() => {
    const n = this.board()?.nse; if (!n) return '';
    if (n.open) return `NSE open · ${n.time ?? ''}`.trim();
    return n.day && this.board()?.session && n.day === this.board()!.session ? 'NSE closed' : (n.status ? `NSE ${n.status.toLowerCase()}` : '');
  });
  readonly ago = computed(() => {
    const t = this.board()?.as_of; if (!t) return '';
    const s = Math.max(0, Math.round(this.now() / 1000 - t));
    return s < 45 ? 'just now' : s < 90 ? '1 min ago' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  });
  basket(v: IVilla): IBasket { return this.gold() === 'with' ? v.with_gold : v.no_gold; }
  other(v: IVilla): IBasket { return this.gold() === 'with' ? v.no_gold : v.with_gold; }
  weights(v: IVilla): { p: string; w: number; c: string; name: string }[] {
    const w = this.gold() === 'with' ? v.weights : v.weights_no_gold;
    return PARTS.filter((p) => (w[p] ?? 0) > 0.0001).map((p) => ({ p, w: w[p], c: PART_COLOUR[p], name: PART_NAME[p] }));
  }
  /** the KPI bar: the headline numbers, in this order */
  readonly kpis = computed(() => ['nifty50', 'n500', 'gold', 'arbitrage', 'usdinr', 'us10y', 'sp500']
    .map((k) => this.items().get(k)).filter((i): i is IItem => !!i && i.ok));
  /** the tip bar under the chart: the hovered moment, or the latest values */
  readonly bar = computed(() => {
    const t = this.tip(); if (t) return { when: t.when, rows: t.rows };
    const ls = this.lines(); if (!ls.length) return null;
    const rows = ls.map((l) => ({ key: l.key, name: l.short, colour: l.colour, value: l.v[l.v.length - 1], villa: l.villa })).sort((a, b) => b.value - a.value);
    const t1 = Math.max(...ls.map((l) => l.t[l.t.length - 1]));
    const d = new Date(t1 * 1000);
    const when = this.range() === '1d' || this.range() === '1w'
      ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST }) + ' IST'
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
    return { when, rows };
  });
  arrow(v: number | null): string { return v === null ? '' : v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '•'; }

  /** the heat tiles, in three groups */
  readonly groups = computed(() => {
    const b = this.board(); if (!b) return [];
    const tile = (i: IItem): Tile => ({
      key: i.key, name: i.name, short: i.short, about: i.about, kind: i.kind, pct: i.pct, day_pct: i.day_pct, last: i.last, prev: i.prev,
      high: i.high, low: i.low, source: i.source, chartable: i.kind !== 'yield' && i.ok, item: i,
    });
    const by = (keys: string[]) => keys.map((k) => b.items.find((i) => i.key === k)).filter((i): i is IItem => !!i).map(tile);
    return [
      { name: 'Indian equity', tiles: by(['nifty50', 'n100', 'mid', 'small', 'n500']) },
      { name: 'Gold & arbitrage', tiles: by(['gold', 'arbitrage']) },
      { name: 'Rupee & the US', tiles: by(['usdinr', 'us10y', 'sp500']) },
    ];
  });

  // ── heat ──────────────────────────────────────────────────────────────────
  private cap(kind: string): number { return (CAPS[kind] ?? CAPS['index'])[this.range()]; }
  heat(v: number | null, kind: string): string | null {
    if (v === null || !isFinite(v)) return null;
    const x = kind === 'yield' ? v * 100 : v;
    const f = Math.min(1, Math.abs(x) / this.cap(kind));
    if (f < 0.04) return 'var(--nw-card2)';
    const pct = Math.round(7 + f * 29);                      // 7 % → 36 % of the move colour over the inset surface
    return `color-mix(in srgb, var(${x > 0 ? '--nw-pos' : '--nw-neg'}) ${pct}%, #ffffff)`;
  }
  tone(v: number | null): 'up' | 'down' | 'flat' { return v === null ? 'flat' : v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : 'flat'; }

  // ── formatting ────────────────────────────────────────────────────────────
  pct(v: number | null, kind: IKind | 'villa' = 'index', digits?: number): string {
    if (v === null || !isFinite(v)) return '—';
    if (kind === 'yield') { const bp = v * 100; return (bp > 0 ? '+' : bp < 0 ? '−' : '') + Math.abs(bp).toFixed(Math.abs(bp) < 10 ? 1 : 0) + ' bp'; }
    const d = digits ?? (this.range() === '1d' || this.range() === '1w' || kind === 'arbitrage' ? 2 : 1);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
  }
  level(t: Tile | IItem): string {
    const v = t.last; if (v === null || v === undefined) return '—';
    switch (t.kind) {
      case 'gold': return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'fx': return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'yield': return v.toFixed(2) + '%';
      case 'arbitrage': return v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
      default: return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    }
  }
  /** the "vs" line under a tile: for 1D the previous close, otherwise today's move */
  sub(t: Tile): string {
    if (this.range() === '1d') {
      if (t.source === 'close') return `close of ${this.day(t.item.session)}`;
      return t.kind === 'index' || t.kind === 'us' ? `prev ${t.prev?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) ?? '—'}` : `prev ${t.prev === null ? '—' : t.kind === 'yield' ? t.prev.toFixed(2) + '%' : '₹' + t.prev.toFixed(2)}`;
    }
    return `today ${this.pct(t.day_pct, t.kind)}`;
  }
  day(s: string | null | undefined): string {
    return s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
  }
  styleOf(key: string) { return STYLE[key] ?? { c: 'var(--muted)' }; }

  // ── the chart ─────────────────────────────────────────────────────────────
  readonly lines = computed<Line[]>(() => {
    const b = this.board(); if (!b) return [];
    const out: Line[] = [];
    for (const key of this.lines$()) {
      const st = STYLE[key]; if (!st) continue;
      if (key.startsWith('villa:')) {
        const v = b.villas.find((x) => 'villa:' + x.key === key); if (!v) continue;
        const bk = this.basket(v); if (!bk.ok || bk.t.length < 2) continue;
        out.push({ key, name: `${v.name} villa`, short: v.name, colour: st.c, dash: st.dash ?? null, width: st.w ?? 2, t: bk.t, v: bk.v, villa: true });
      } else {
        const i = this.items().get(key); if (!i || !i.ok || i.t.length < 2 || i.kind === 'yield') continue;
        out.push({ key, name: i.name, short: i.short, colour: st.c, dash: st.dash ?? null, width: st.w ?? 2, t: i.t, v: i.v, villa: false });
      }
    }
    return out;
  });
  /** names next to the end values only when the plot is wide enough for them */
  readonly endNames = computed(() => this.box().w >= 680);
  readonly padR = computed(() => this.endNames() ? 132 : 70);
  readonly cw = computed(() => Math.max(120, this.box().w - PAD.l - this.padR()));
  readonly ch = computed(() => Math.max(80, this.box().h - PAD.t - PAD.b));
  readonly padL = PAD.l; readonly padT = PAD.t;
  private span = computed(() => {
    const ls = this.lines(); if (!ls.length) return null;
    const t0 = Math.min(...ls.map((l) => l.t[0])), t1 = Math.max(...ls.map((l) => l.t[l.t.length - 1]));
    let lo = 0, hi = 0;
    for (const l of ls) for (const v of l.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * 0.08 || 0.1;
    return { t0, t1: t1 > t0 ? t1 : t0 + 60, lo: lo - pad, hi: hi + pad };
  });
  x(t: number): number { const s = this.span()!; return ((t - s.t0) / (s.t1 - s.t0)) * this.cw(); }
  y(v: number): number { const s = this.span()!; return this.ch() - ((v - s.lo) / (s.hi - s.lo)) * this.ch(); }
  readonly paths = computed(() => {
    if (!this.span()) return [];
    const w = this.cw();
    return this.lines().map((l) => {
      const step = Math.max(1, Math.floor(l.t.length / (w * 1.5)));
      let p = '';
      for (let i = 0; i < l.t.length; i += step) p += (p ? 'L' : 'M') + this.x(l.t[i]).toFixed(1) + ' ' + this.y(l.v[i]).toFixed(1);
      const n = l.t.length - 1;
      if (n % step) p += 'L' + this.x(l.t[n]).toFixed(1) + ' ' + this.y(l.v[n]).toFixed(1);
      return { key: l.key, colour: l.colour, dash: l.dash, width: l.width, d: p, villa: l.villa };
    });
  });
  readonly yTicks = computed(() => {
    const s = this.span(); if (!s) return [];
    const n = Math.max(3, Math.floor(this.ch() / 44));
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
    const maxN = Math.max(3, Math.floor(this.cw() / (this.cw() < 420 ? 62 : 84)));
    const spanS = s.t1 - s.t0;
    if (this.range() === '1d' || this.range() === '1w') {
      const hours = spanS / 3600;
      const stepH = this.range() === '1d' ? ([1, 2, 3, 4, 6].find((h) => hours / h <= maxN) ?? 6) : ([6, 12, 24].find((h) => hours / h <= maxN) ?? 24);
      // ticks on IST whole hours
      const off = 5.5 * 3600;
      let t = Math.ceil((s.t0 + off) / (stepH * 3600)) * stepH * 3600 - off;
      for (; t <= s.t1; t += stepH * 3600) {
        const d = new Date(t * 1000);
        const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST });
        const label = this.range() === '1w' ? (hm === '00:00' || stepH >= 24 ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: IST }) : hm) : hm;
        if (this.range() === '1w' && stepH >= 24 && hm !== '00:00') continue;
        out.push({ x: this.x(t), label });
      }
      return out;
    }
    const days = spanS / 86400;
    const stepD = [1, 2, 3, 5, 7, 14, 30, 61, 91].find((d) => days / d <= maxN) ?? 182;
    const d0 = new Date(s.t0 * 1000); d0.setUTCHours(12, 0, 0, 0);
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
    while (d.getTime() / 1000 <= s.t1) {
      if (k % stepD === 0) out.push({ x: this.x(d.getTime() / 1000), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
      d.setUTCDate(d.getUTCDate() + 1); k++;
    }
    return out;
  });
  /** end-of-line labels, nudged apart */
  readonly ends = computed(() => {
    if (!this.span()) return [];
    const H = this.ch();
    const ls = this.lines().map((l) => {
      const v = l.v[l.v.length - 1];
      return { key: l.key, colour: l.colour, name: l.short, value: v, y0: this.y(v), y: this.y(v), x: this.x(l.t[l.t.length - 1]), villa: l.villa };
    }).sort((a, b) => a.y - b.y);
    const gap = Math.min(30, H / Math.max(1, ls.length));
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
      return i < 0 ? null : { key: l.key, name: l.short, colour: l.colour, value: l.v[i], y: this.y(l.v[i]), villa: l.villa };
    }).filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.value - a.value);
    const d = new Date(t * 1000);
    const when = this.range() === '1d' || this.range() === '1w'
      ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST }) + ' IST'
      : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const x = this.x(t);
    return { x, flip: x > this.cw() * 0.58, when, rows };
  });
  readonly spanLabel = computed(() => {
    const s = this.span(); if (!s) return '';
    const f = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t * 1000).toLocaleString('en-GB', o);
    if (this.range() === '1d') return `${f(s.t0, { hour: '2-digit', minute: '2-digit', timeZone: IST })} – ${f(s.t1, { hour: '2-digit', minute: '2-digit', timeZone: IST })} IST`;
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: this.range() === '1w' ? IST : 'UTC', ...(this.range() === '1w' || this.range() === '1m' ? {} : { year: 'numeric' }) };
    return `${f(s.t0, o)} – ${f(s.t1, o)}`;
  });
  readonly chipRet = computed(() => {
    const m: Record<string, number> = {};
    for (const l of this.lines()) m[l.key] = l.v[l.v.length - 1];
    return m;
  });
  readonly arbNote = computed(() => {
    const a = this.items().get('arbitrage');
    return a?.ok ? `Arbitrage index: close of ${this.day(a.session)} (it is not quoted live)` : '';
  });
  trackKey = (_: number, x: { key: string }) => x.key;
}
