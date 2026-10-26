import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';

import { EstateService, FundMove, FundMoves } from '../estate.service';
import { inr } from '../shared/format.util';

type Range = '1d' | '1m' | '3m' | '6m' | '1y' | '3y' | 'all' | 'custom';
const RANGES: { k: Range; l: string; n: number; words: string }[] = [
  { k: '1d', l: '1D', n: 1, words: 'Today' }, { k: '1m', l: '1M', n: 22, words: 'Last month' }, { k: '3m', l: '3M', n: 66, words: 'Last 3 months' }, { k: '6m', l: '6M', n: 132, words: 'Last 6 months' },
  { k: '1y', l: '1Y', n: 252, words: 'Last 12 months' }, { k: '3y', l: '3Y', n: 756, words: 'Last 3 years' }, { k: 'all', l: 'All', n: 1e9, words: 'Since you started' },
  { k: 'custom', l: 'Custom', n: 1e9, words: 'Your dates' },
];
const W = 320, H = 150;
const CHOICE_KEY = 'tdc.invest.index';

/** what each index is, in one line — shown behind the (i) and in the picker */
const INDEX_ABOUT: [RegExp, string][] = [
  [/arbitrage/i, 'The return from buying shares and selling their futures — the income part of a villa'],
  [/gold/i, 'The domestic price of gold'],
  [/smallcap|small cap/i, 'The 250 small companies after the top 250'],
  [/midcap|mid cap/i, 'The 150 mid-sized companies after the top 100'],
  [/nifty ?500/i, 'The 500 largest listed companies'],
  [/next ?50/i, 'The 50 companies after the top 50'],
  [/nifty ?100/i, 'The 100 largest listed companies'],
  [/nifty ?50\b/i, 'The 50 largest listed companies'],
];

/** a smooth (monotone cubic) path through points — no overshoot between days */
function smooth(p: [number, number][]): string {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const n = p.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / ((p[i + 1][0] - p[i][0]) || 1e-6));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  let out = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = p[i + 1][0] - p[i][0];
    out += `C${(p[i][0] + h / 3).toFixed(1)} ${(p[i][1] + m[i] * h / 3).toFixed(1)} ${(p[i + 1][0] - h / 3).toFixed(1)} ${(p[i + 1][1] - m[i + 1] * h / 3).toFixed(1)} ${p[i + 1][0].toFixed(1)} ${p[i + 1][1].toFixed(1)}`;
  }
  return out;
}

/** one trading day inside the window: your % (cash flows taken out) and the indices' % */
interface Day { d: string; g: number; pct: number; idx: number | null; chg: number; }
interface IndexChoice { all: string | null; per: Record<string, string>; }

/**
 * Investments — opened by a tap on the home's portfolio value (nowhere else). Current value; your
 * portfolio against the index over a period (both drawn as the growth of ₹1,00,000, the gap shaded =
 * alpha); every fund with its money first, and on a tap its comparison with its index: over the
 * period, and day by day.
 *   · "the index" = each fund's own benchmark weighted by what the client holds — unless the client
 *     picks another index for a fund, or one index for everything (kept on this phone).
 *   · periods: 1M 3M 6M 1Y 3Y All, or any two dates.
 *   · Money added inside the window is not counted as a gain.
 * Data: GET /me/funds/moves (cached by EstateService) + the home's own value / invested.
 */
@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './investments.component.html',
  styleUrl: './investments.component.scss',
})
export class InvestmentsComponent {
  readonly est = inject(EstateService);
  readonly RANGES = RANGES;
  readonly W = W; readonly H = H;
  readonly FW = 300; readonly FH = 110;
  @Output() back = new EventEmitter<void>();

  constructor() { this.est.loadMoves(); }

  readonly m = computed<FundMoves | null>(() => this.est.moves());
  inr = inr;

  // ── the headline ──
  get value(): number { return this.est.estateValue; }
  get invested(): number { return this.est.invested; }

  // ── which index: the fund's own, one the client picked for it, or one for everything ──
  readonly choice = signal<IndexChoice>(this.loadChoice());
  private loadChoice(): IndexChoice {
    try { const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || ''); return { all: c.all ?? null, per: c.per ?? {} }; } catch { return { all: null, per: {} }; }
  }
  private saveChoice(c: IndexChoice): void { this.choice.set(c); try { localStorage.setItem(CHOICE_KEY, JSON.stringify(c)); } catch { /* private mode */ } }
  setAll(key: string | null): void { this.saveChoice({ all: key, per: key ? {} : this.choice().per }); if (navigator.vibrate) navigator.vibrate(3); }
  setFor(code: number, key: string | null): void {
    const per = { ...this.choice().per }; if (key) per[code] = key; else delete per[code];
    this.saveChoice({ ...this.choice(), per }); if (navigator.vibrate) navigator.vibrate(3);
  }
  /** every index on offer */
  readonly indices = computed(() => (this.m()?.indices ?? []).map((x) => ({ ...x, about: INDEX_ABOUT.find(([re]) => re.test(x.short) || re.test(x.name))?.[1] ?? '' })));
  indexKeyFor(f: FundMove): string | null { return this.choice().all ?? this.choice().per[f.scheme_code] ?? f.bench?.key ?? null; }
  ownKey(f: FundMove): string | null { return f.bench?.key ?? null; }
  indexShort(key: string | null): string { return key ? (this.indices().find((x) => x.key === key)?.short ?? key) : 'Index'; }
  /** the index series for a fund, aligned to its nav_series (the chosen index, else the one it came with) */
  private idxSeriesFor(f: FundMove): (number | null)[] {
    const key = this.indexKeyFor(f);
    const ix = key ? this.m()?.indices?.find((x) => x.key === key) : null;
    if (!ix) return f.index_series;
    return ix.series.slice(f.from, f.from + f.nav_series.length);
  }
  private isChanged(f: FundMove): boolean { return this.indexKeyFor(f) !== (f.bench?.key ?? null); }

  // ── the period ──
  readonly wanted = signal<Range>('1d');
  readonly custom = signal<{ from: string; to: string }>({ from: '', to: '' });
  /** ranges the history can actually fill (a 2-month-old estate has no 1Y), always + Custom */
  readonly ranges = computed(() => { const n = this.allDays().length; return RANGES.filter((r, i) => i === 0 || r.k === 'all' || r.k === 'custom' || n > RANGES[i - 1].n); });
  readonly range = computed<Range>(() => { const rs = this.ranges(); return rs.some((r) => r.k === this.wanted()) ? this.wanted() : 'all'; });
  readonly rangeWords = computed(() => {
    if (this.range() === '1d') { const ds = this.days(); return ds.length ? this.dayLong(ds[ds.length - 1].d) : 'Today'; }
    if (this.range() === 'custom') { const ds = this.days(); return ds.length ? `${this.day(ds[0].d)} – ${this.day(ds[ds.length - 1].d)}` : 'Pick two dates'; }
    return RANGES.find((r) => r.k === this.range())!.words;
  });
  setRange(r: Range): void {
    this.wanted.set(r); this.scrub.set(null); this.fscrub.set(null); if (navigator.vibrate) navigator.vibrate(3);
    if (r === 'custom' && !this.custom().from) { const all = this.allDays(); if (all.length) this.custom.set({ from: all[Math.max(0, all.length - 66)].d, to: all[all.length - 1].d }); }
  }
  setCustom(which: 'from' | 'to', v: string): void { this.custom.set({ ...this.custom(), [which]: v }); this.scrub.set(null); this.fscrub.set(null); }
  readonly minDay = computed(() => this.allDays()[0]?.d ?? '');
  readonly maxDay = computed(() => { const a = this.allDays(); return a[a.length - 1]?.d ?? ''; });

  // ── every trading day since the first purchase ──
  readonly allDays = computed<Day[]>(() => {
    const m = this.m(); const p = m?.portfolio; if (!m || !p) return [];
    const out: Day[] = [];
    for (let k = 1; k < p.value.length; k++) {
      const v0 = p.value[k - 1], v1 = p.value[k]; if (!v0) continue;
      const chg = (v1 - v0) - (p.invested[k] - p.invested[k - 1]);
      const g = p.from + k;
      out.push({ d: m.days[g], g, pct: chg / v0 * 100, idx: this.idxOn(m, g), chg });
    }
    return out;
  });
  /** the funds' indices on day g (each fund's chosen index), weighted by what the client holds */
  private idxOn(m: FundMoves, g: number): number | null {
    let w = 0, s = 0, real = 0;
    for (const f of m.funds as FundMove[]) {
      if (!f.weight) continue;
      const ser = this.idxSeriesFor(f);
      const i = g - f.from, a = ser[i - 1], b = ser[i];
      if (i >= 1 && a && b != null && a !== b) { w += f.weight; s += f.weight * (b / a - 1) * 100; real += f.weight; continue; }
      // this fund's index hasn't published the day yet: count the fund's own move (no alpha from it that day)
      const na = i >= 1 ? f.nav_series[i - 1] : null, nb = i >= 0 ? f.nav_series[i] : null;
      if (na && nb != null && i >= 1) { w += f.weight; s += f.weight * (nb / na - 1) * 100; }
    }
    if (!real) w = 0;
    if (!w && m.days[g] === m.nav_date) {                                   // the newest day: the live index moves
      let wv = 0, sv = 0;
      for (const f of m.funds) { if (this.isChanged(f)) continue; const b = f.bench?.day_pct; if (b == null || !f.value) continue; wv += f.value; sv += f.value * b; }
      return wv ? sv / wv : null;
    }
    return w ? s / w : null;
  }
  readonly days = computed<Day[]>(() => {
    const all = this.allDays(), r = this.range();
    if (r === 'custom') { const { from, to } = this.custom(); return all.filter((d) => (!from || d.d >= from) && (!to || d.d <= to)); }
    const n = RANGES.find((x) => x.k === r)!.n;
    return all.slice(Math.max(0, all.length - n));
  });

  // ── your money vs the same money in the index, in rupees over the window ──
  /** your value day by day, and what the same rupees (each addition on its day) would be worth in the index */
  readonly growth = computed(() => this.growthOf(this.days()));
  /** the days the charts draw: the period, or on 1D the last month so the graph is always there */
  readonly chartDays = computed<Day[]>(() => { if (this.range() !== '1d') return this.days(); const all = this.allDays(); return all.slice(Math.max(0, all.length - 22)); });
  readonly chartGrowth = computed(() => this.growthOf(this.chartDays()));
  private growthOf(ds: Day[]) {
    const m = this.m(); const p = m?.portfolio; if (!m || !p || !ds.length) return null;
    const k0 = ds[0].g - p.from - 1;                                        // the close the window starts from
    let idxV = p.value[k0], base = p.value[k0];                             // the index starts with what you had
    const A = [p.value[k0]], B = [idxV], Ag = [0], Bg = [0];                 // values, and the gain so far (money added taken out)
    for (const d of ds) {
      const k = d.g - p.from, flow = p.invested[k] - p.invested[k - 1];
      idxV = idxV * (1 + (d.idx ?? 0) / 100) + flow; base += Math.max(0, flow);
      A.push(p.value[k]); B.push(idxV); Ag.push(p.value[k] - base); Bg.push(idxV - base);
    }
    const you = A[A.length - 1], idx = B[B.length - 1];
    return { you, idx, lead: you - idx, mine: base ? (you / base - 1) * 100 : 0, idxPct: base ? (idx / base - 1) * 100 : 0, leadPct: base ? (you - idx) / base * 100 : 0,
             chg: you - base, A, B, Ag, Bg, from: ds[0].d, to: ds[ds.length - 1].d };
  }
  readonly chart = computed(() => {
    const g = this.chartGrowth(); if (!g || g.A.length < 2) return null;
    const vals = [0, ...g.Ag, ...g.Bg];
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1;
    const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16);
    const x = (i: number) => (i / (g.A.length - 1)) * W;
    const path = (vs: number[]) => smooth(vs.map((v, i) => [x(i), y(v)] as [number, number]));
    const mine = path(g.Ag), idx = path(g.Bg);
    const ds = this.chartDays(), n = ds.length;
    const ticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({ x: x(i + 1), label: this.day(ds[i].d) })) : [];
    const topP: [number, number][] = g.Ag.map((v, i) => [x(i), y(Math.max(v, g.Bg[i]))]);
    const botP: [number, number][] = g.Ag.map((v, i) => [x(i), y(Math.min(v, g.Bg[i]))]);
    const band = `M${topP.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')} L${botP.slice().reverse().map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')} Z`;
    return { mine, idx, band, area: `${mine} L${W} ${y(0).toFixed(1)} L0 ${y(0).toFixed(1)} Z`, zero: y(0), endMine: y(g.Ag[g.Ag.length - 1]), endIdx: y(g.Bg[g.Bg.length - 1]), x, y, ticks,
             grid: [0.25, 0.5, 0.75].map((f) => 8 + f * (H - 16)) };
  });
  readonly scrub = signal<number | null>(null);
  onScrub(ev: PointerEvent, el: Element): void {
    const g = this.chartGrowth(); if (!g) return;
    const r = el.getBoundingClientRect();
    this.scrub.set(Math.max(0, Math.min(g.A.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (g.A.length - 1)))));
  }
  readonly scrubAt = computed(() => {
    const g = this.chartGrowth(), c = this.chart(), i = this.scrub(); if (!g || !c || i == null) return null;
    const ds = this.chartDays();
    return { d: i === 0 ? ds[0].d : ds[i - 1].d, mine: g.A[i], idx: g.B[i], gMine: g.Ag[i], gIdx: g.Bg[i], x: c.x(i), yMine: c.y(g.Ag[i]), yIdx: c.y(g.Bg[i]) };
  });
  /** the index's name on the card: the one chosen for everything, one fund's own, or "Index" when they differ */
  readonly indexName = computed(() => {
    if (this.choice().all) return this.indexShort(this.choice().all);
    const names = [...new Set((this.m()?.funds ?? []).filter((f) => f.value > 0).map((f) => this.indexShort(this.indexKeyFor(f))))];
    return names.length === 1 ? names[0] : 'Index';
  });
  readonly infoOpen = signal(false);
  /** the (i): every index in the comparison — what it is, which of your funds follow it, its weight */
  readonly indexInfo = computed(() => {
    const m = this.m(); if (!m) return [];
    const total = m.funds.reduce((s, f) => s + (f.value || 0), 0) || 1;
    const by = new Map<string, { key: string; name: string; about: string; funds: string[]; weight: number }>();
    for (const f of m.funds) {
      if (!f.value) continue;
      const key = this.indexKeyFor(f) ?? 'n500', name = this.indexShort(key);
      const e = by.get(key) ?? { key, name, about: this.indices().find((x) => x.key === key)?.about ?? '', funds: [], weight: 0 };
      e.funds.push(f.short || f.name); e.weight += f.value / total * 100; by.set(key, e);
    }
    return [...by.values()].sort((a, b) => b.weight - a.weight);
  });

  // ── when the figures were published, and when the next ones come ──
  /** the day's move: the home's own figure (same numbers everywhere), else the comparison data's */
  readonly today = computed(() => {
    const d = this.est.portfolio()?.day, m = this.m();
    if (d && d.change != null) return { change: d.change, pct: d.pct, nav: d.nav_date, prev: d.prev_date, lagging: d.lagging || 0, funds: d.funds || 0 };
    if (m?.total?.change != null) return { change: m.total.change, pct: m.total.pct, nav: m.nav_date, prev: m.prev_date, lagging: 0, funds: 0 };
    return null;
  });
  /** which NAV the page shows, when it was pulled, and when the next one comes (AMCs publish ~9–11 PM IST on weekdays) */
  readonly timing = computed(() => {
    const p = this.est.portfolio(), m = this.m();
    const nav = this.today()?.nav || p?.nav_date || m?.nav_date; if (!nav) return null;
    const istNow = new Date(Date.now() + 330 * 60_000);
    const todayIso = istNow.toISOString().slice(0, 10), hour = istNow.getUTCHours();
    const tomorrowIso = new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
    const d = new Date(nav + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    const next = d.toISOString().slice(0, 10);
    let nextV: string, nextS: string;
    if (next < todayIso || (next === todayIso && hour >= 21)) { nextV = 'Any minute'; nextS = 'AMCs are publishing · we check every 10 min'; }
    else if (next === todayIso) { nextV = 'Tonight'; nextS = this.dayLong(next) + ' · from 9 PM'; }
    else if (next === tomorrowIso) { nextV = 'Tomorrow'; nextS = this.dayLong(next) + ' · from 9 PM'; }
    else { nextV = this.dayLong(next); nextS = 'from 9 PM'; }
    const fa = p?.fetched_at ? new Date(p.fetched_at) : null;
    const pulled = fa && !isNaN(fa.getTime())
      ? fa.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).replace(/\s?(am|pm)/i, (x) => ' ' + x.trim().toUpperCase())
      : null;
    return { nav: this.dayLong(nav), isToday: nav === todayIso, pulled, nextV, nextS };
  });

  // ── fund by fund ──
  readonly funds = computed(() => {
    const m = this.m(), ds = this.days(); if (!m) return [];
    const total = m.funds.reduce((s, f) => s + (f.value || 0), 0) || 1;
    const g0 = ds.length ? ds[0].g - 1 : null;
    return (m.funds as FundMove[]).filter((f) => f.value > 0 || f.invested > 0).map((f) => {
      const ser = this.idxSeriesFor(f);
      let ret: number | null = null, iret: number | null = null, since: string | null = null;
      if (g0 != null && f.nav_series.length > 1) {
        let i0 = Math.max(0, g0 - f.from);
        while (i0 < f.nav_series.length - 1 && f.nav_series[i0] == null) i0++;
        const iEnd = Math.min(f.nav_series.length - 1, ds[ds.length - 1].g - f.from);
        const n0 = f.nav_series[i0], n1 = f.nav_series[iEnd] ?? f.nav;
        if (n0 && n1 && iEnd > i0) ret = (n1 / n0 - 1) * 100;
        if (g0 - f.from < 0) since = m.days[f.from + i0];
        let j0 = i0; while (j0 < iEnd && ser[j0] == null) j0++;
        let j1 = iEnd; while (j1 > j0 && ser[j1] == null) j1--;
        const x0 = ser[j0], x1 = ser[j1];
        if (x0 && x1 && j1 > j0) iret = (x1 / x0 - 1) * 100;
      }
      const key = this.indexKeyFor(f);
      return { key: f.scheme_code, f, name: f.short || f.name, sleeve: this.sleeveName(f.sleeve), bench: this.indexShort(key), benchKey: key, changed: this.isChanged(f),
               share: f.value / total * 100, invested: f.invested, value: f.value, pnl: f.value - f.invested, ret, iret,
               gap: ret != null && iret != null ? ret - iret : null, since };
    }).sort((a, b) => b.value - a.value);
  });
  private sleeveName(s: string): string {
    return ({ arbitrage: 'Arbitrage', gold: 'Gold', large: 'Large cap', mid: 'Mid cap', small: 'Small cap', flexi: 'Flexi cap', hybrid: 'Hybrid', debt: 'Debt', multi: 'Multi cap' } as Record<string, string>)[s] || s || 'Fund';
  }

  /** the fund whose comparison is open (tap a card) */
  readonly openKey = signal<number | null>(null);
  readonly pickOpen = signal(false);
  toggleFund(key: number): void { this.openKey.set(this.openKey() === key ? null : key); this.fscrub.set(null); this.pickOpen.set(false); if (navigator.vibrate) navigator.vibrate(3); }
  private openFund(): FundMove | null { const key = this.openKey(), m = this.m(); return key == null || !m ? null : (m.funds as FundMove[]).find((x) => x.scheme_code === key) ?? null; }
  /** the open fund's window inside its own series: [i0, iEnd] */
  private fundWindow(f: FundMove): [number, number] | null {
    const ds = this.chartDays(); if (!ds.length) return null;
    const g0 = ds[0].g - 1, gEnd = ds[ds.length - 1].g;
    let i0 = Math.max(0, g0 - f.from); while (i0 < f.nav_series.length - 1 && f.nav_series[i0] == null) i0++;
    const iEnd = Math.min(f.nav_series.length - 1, gEnd - f.from);
    return iEnd - i0 < 1 ? null : [i0, iEnd];
  }
  /** the open fund against its index — the only thing an open card shows; both as the growth of ₹1 over the window */
  readonly fundChart = computed(() => {
    const m = this.m(), f = this.openFund(); if (!m || !f) return null;
    const win = this.fundWindow(f); if (!win) return null; const [i0, iEnd] = win;
    const ser = this.idxSeriesFor(f);
    const n0 = f.nav_series[i0]; let j0 = i0; while (j0 <= iEnd && !ser[j0]) j0++;
    const x0 = ser[j0] ?? null;
    const A: number[] = [], B: (number | null)[] = [], D: string[] = []; let lastIdx: number | null = null;
    for (let i = i0; i <= iEnd; i++) {
      const nv = f.nav_series[i]; A.push(nv && n0 ? nv / n0 : (A[A.length - 1] ?? 1));
      const iv = ser[i]; if (iv && x0) lastIdx = iv / x0; B.push(x0 ? lastIdx : null); D.push(m.days[f.from + i]);
    }
    const Bv = B.map((v) => v ?? 1);
    const lo = Math.min(1, ...A, ...Bv), hi = Math.max(1, ...A, ...Bv), pad = (hi - lo) * 0.12 || 0.01;
    const Wf = this.FW, Hf = this.FH;
    const y = (v: number) => Hf - 6 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (Hf - 12);
    const x = (i: number) => (i / (A.length - 1)) * Wf;
    const pts = (vs: number[]) => vs.map((v, i) => [x(i), y(v)] as [number, number]);
    const ticks = [0, Math.floor((D.length - 1) / 2), D.length - 1].map((i) => ({ x: x(i), label: this.day(D[i]) }));
    return { fund: smooth(pts(A)), idx: x0 ? smooth(pts(Bv)) : null, zero: y(1), A, B, D, x, y, ticks,
             fundRet: (A[A.length - 1] - 1) * 100, idxRet: lastIdx == null ? null : (lastIdx - 1) * 100 };
  });
  /** finger on the fund chart */
  readonly fscrub = signal<number | null>(null);
  onFundScrub(ev: PointerEvent, el: Element): void {
    const fc = this.fundChart(); if (!fc) return;
    const r = el.getBoundingClientRect();
    this.fscrub.set(Math.max(0, Math.min(fc.A.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (fc.A.length - 1)))));
  }
  readonly fscrubAt = computed(() => {
    const fc = this.fundChart(), i = this.fscrub() ?? (fc ? fc.A.length - 1 : null); if (!fc || i == null) return null;
    const b = fc.B[i];
    return { d: fc.D[i], fund: (fc.A[i] - 1) * 100, idx: b == null ? null : (b - 1) * 100, x: fc.x(i), yFund: fc.y(fc.A[i]), yIdx: b == null ? null : fc.y(b), live: this.fscrub() != null };
  });

  /** the biggest peak-to-trough fall inside the window, for you and for the index (time-weighted, money added taken out) */
  readonly drawdown = computed(() => {
    const ds = this.days(); if (ds.length < 2) return null;
    const dd = (pick: (d: Day) => number | null) => {
      let v = 1, peak = 1, worst = 0, pd = ds[0].d, from = ds[0].d, to = ds[0].d, cur = ds[0].d;
      for (const d of ds) {
        v *= 1 + (pick(d) ?? 0) / 100;
        if (v > peak) { peak = v; cur = d.d; }
        const fall = v / peak - 1;
        if (fall < worst) { worst = fall; from = cur; to = d.d; pd = d.d; }
      }
      return { pct: worst * 100, from, to };
    };
    const idx = dd((d) => d.idx);
    // you over the SAME days, in rupees, against the money you actually had in then (not a tiny early SIP's %)
    const g = this.growth(); let you: { pct: number; chg: number } | null = null;
    if (g) {
      const i0 = ds.findIndex((d) => d.d === idx.from), i1 = ds.findIndex((d) => d.d === idx.to);
      if (i0 >= 0 && i1 > i0) {
        const a = i0 + 1, b = i1 + 1;                                      // growth arrays start one day earlier
        const inflow = (g.A[b] - g.Ag[b]) - (g.A[a] - g.Ag[a]);              // money added between the two days
        const cap = g.A[a] + Math.max(0, inflow);
        const chg = g.Ag[b] - g.Ag[a];
        you = { pct: cap ? chg / cap * 100 : 0, chg };
      }
    }
    return { idx, you };
  });

  /** an open fund's move on its newest NAV day, and its index's move that day */
  fundDay(f: FundMove): { d: string | null; chg: number | null; pct: number | null; idx: number | null } {
    const m = this.m(); if (!m) return { d: null, chg: null, pct: null, idx: null };
    const d = f.nav_date;
    let idx: number | null = null;
    const g = d ? m.days.indexOf(d) : -1;
    if (g > 0) {
      const ser = this.idxSeriesFor(f), i = g - f.from;
      let j = i - 1; while (j >= 0 && ser[j] == null) j--;
      const a = j >= 0 ? ser[j] : null, b = i >= 0 ? ser[i] : null;
      if (a && b != null && a !== b) idx = (b / a - 1) * 100;
    }
    if (idx == null && !this.isChanged(f) && f.bench?.day_pct != null && f.bench.day_date === d) idx = f.bench.day_pct;
    return { d, chg: f.day_change, pct: f.day_pct, idx };
  }

  /** the newest day's index move (null when no index has published it yet) */
  readonly lastIdx = computed(() => { const ds = this.days(); return ds.length ? ds[ds.length - 1].idx : null; });
  /** the 1D bars share one scale */
  dayW(v: number | null, other: number | null): number { const sc = Math.max(0.05, Math.abs(v ?? 0), Math.abs(other ?? 0)); return Math.abs(v ?? 0) / sc * 100; }

  /** ₹99.12 L / ₹1.02 Cr for the big figures (full ₹ below 10 L) */
  money(v: number | null | undefined): string {
    if (v == null) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e6) return `${s}₹${(a / 1e5).toFixed(2)} L`;
    return s + inr(Math.round(a));
  }
  signedMoney(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−' : '+') + this.money(Math.abs(v)); }

  // ── words ──
  p(v: number | null | undefined, dp = 1): string { if (v == null || !isFinite(v)) return '—'; const t = Math.abs(v).toFixed(dp); return (Number(t) === 0 ? '' : v < 0 ? '−' : '+') + t + '%'; }
  p2(v: number | null | undefined): string { return this.p(v, 2); }
  signed(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−' : '+') + inr(Math.abs(Math.round(v))); }
  day(iso: string | null | undefined): string { return iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; }
  dayLong(iso: string | null | undefined): string { return iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; }
  tone(v: number | null | undefined): 'gain' | 'loss' | '' { return v == null ? '' : v > 0.0001 ? 'gain' : v < -0.0001 ? 'loss' : ''; }
}
