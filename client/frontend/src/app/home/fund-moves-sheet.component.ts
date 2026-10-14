import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';

import { EstateService, FundMove, FundMoves } from '../estate.service';
import { inr } from '../shared/format.util';

/** Sleeve → colour + plain label (the same palette as the home allocation bar). */
const SLEEVES: Record<string, { name: string; color: string }> = {
  arbitrage: { name: 'Arbitrage', color: '#8aa89b' },
  debt: { name: 'Debt', color: '#7fa9c9' },
  hybrid: { name: 'Hybrid', color: '#a99be6' },
  gold: { name: 'Gold', color: '#f6c445' },
  large: { name: 'Large cap', color: '#4a9d47' },
  multi: { name: 'Multi cap', color: '#3f9a86' },
  mid: { name: 'Mid cap', color: '#5cb85c' },
  small: { name: 'Small cap', color: '#8fd48a' },
  other: { name: 'Other', color: '#9fb3ab' },
};

type View = 'growth' | 'today' | 'index';
type Win = 'since' | '1y' | '3y' | '5y';

/** One fund row of the Today view: its move and its index's, on one scale. */
interface TodayRow {
  key: number; name: string; color: string; sleeve: string;
  change: number | null; pct: number | null; bench: string; benchPct: number | null; benchPending: boolean;
  wF: number; wB: number; nav: number | null; prev: number | null; late: boolean; when: string;
}

/** The fund-vs-index line chart (viewBox 320 × 150). */
interface Line {
  fund: string; index: string; area: string;
  base: number;                      // y of the 100 line
  n: number; start: string; end: string;
  fundEnd: number; indexEnd: number; // % since the window's start
  min: number; max: number;
}
/** The day-by-day bars under it (viewBox 320 × 64). */
interface Bars {
  bars: { x: number; y: number; h: number; up: boolean }[];
  w: number; zero: number; per: 'day' | 'week' | 'month';
  best: number; worst: number; ups: number; total: number; idx: string;
}
/** The growth chart: what was put in (steps) vs what it was worth (line). */
interface Growth {
  value: string; area: string; invested: string;
  n: number; start: string; end: string; min: number; max: number;
}

const W = 320, H = 150, BH = 64;

/**
 * "How your money grew" — opened from the growth line under the portfolio value.
 *
 *  · Growth    the whole estate: what was put in vs what it was worth, day by
 *              day since the first purchase (or 1y / 3y / 5y), scrubbable, with
 *              the ₹ and % at the top.
 *  · Today     each fund's move between its last two NAVs, as a bar either side
 *              of a centre line, with its index's move for the same day drawn
 *              underneath on the SAME scale, so "beat its index" is visible at a
 *              glance. Rows add up to the day's move exactly.
 *  · Vs index  one fund at a time: its NAV and its index rebased to 100 from the
 *              day the client first bought it (or 1y / 3y / 5y), a scrubbable
 *              line chart, then every day's % move as bars with best / worst /
 *              up-days underneath.
 *
 * Data arrives in one call (EstateService.loadMoves) and is cached, so flipping
 * between views and funds is instant; until it lands the sheet shows a quiet
 * skeleton, never a figure that then changes.
 */
@Component({
  selector: 'app-fund-moves',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fund-moves-sheet.component.html',
  styleUrl: './fund-moves-sheet.component.scss',
})
export class FundMovesSheetComponent {
  readonly est = inject(EstateService);

  private _open = signal(false);
  @Input() set open(v: boolean) { this._open.set(!!v); if (v) this.est.loadMoves(); }
  get open(): boolean { return this._open(); }
  @Output() closed = new EventEmitter<void>();

  readonly view = signal<View>('growth');
  readonly win = signal<Win>('since');                 // vs-index window
  readonly gwin = signal<Win>('since');                // growth window
  readonly pick = signal<number | null>(null);         // scheme_code of the fund in the vs-index view
  readonly scrub = signal<number | null>(null);        // index into the window's points (vs index)
  readonly gscrub = signal<number | null>(null);       // index into the growth window's points
  readonly isOpen = computed(() => this._open());
  readonly m = computed<FundMoves | null>(() => this.est.moves());

  constructor() {
    // first fund (biggest holding) selected once the data lands
    effect(() => { const m = this.m(); if (m && this.pick() === null && m.funds.length) { this.pick.set(m.funds[0].scheme_code); this.defaultWin(); } }, { allowSignalWrites: true });
  }

  close(): void { this._open.set(false); this.closed.emit(); }
  setView(v: View): void { this.view.set(v); this.scrub.set(null); this.gscrub.set(null); }
  setWin(w: Win): void { if (this.winOk(w)) { this.win.set(w); this.scrub.set(null); } }
  setGwin(w: Win): void { if (this.gwinOk(w)) { this.gwin.set(w); this.gscrub.set(null); } }
  setPick(code: number): void { this.pick.set(code); this.scrub.set(null); this.defaultWin(); }
  /** "Since you bought" only when there is something to see (≥ 20 trading days); else 1Y. */
  private defaultWin(): void {
    const m = this.m(), f = this.fund();
    if (!m || !f) return;
    if (this.win() === 'since' || !this.winOk(this.win())) {
      const start = this.winStart('since', f, m.days);
      const n = f.nav_series.filter((_, i) => m.days[f.from + i] >= start).length;
      this.win.set(f.since && n >= 20 ? 'since' : this.winOk('1y') ? '1y' : 'since');
    }
  }

  // ── formatting ────────────────────────────────────────────────────────────
  inr(v: number | null | undefined): string { return v == null ? '—' : inr(v); }
  signedInr(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−' : '+') + inr(Math.abs(v)); }
  signedPct(v: number | null | undefined, dp?: number): string {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    return (v < 0 ? '−' : '+') + a.toFixed(dp ?? (a < 1 ? 2 : 1)) + '%';
  }
  dayShort(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  dateShort(iso: string | null | undefined, year = true): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: '2-digit' } : {}), timeZone: 'UTC' });
  }
  dayWhen(iso: string | null | undefined): string {
    if (!iso) return '';
    const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    if (iso === ist(Date.now())) return 'Today';
    if (iso === ist(Date.now() - 86_400_000)) return 'Yesterday';
    return this.dayShort(iso);
  }
  color(s: string): string { return SLEEVES[s]?.color ?? SLEEVES['other'].color; }
  sleeveName(s: string): string { return SLEEVES[s]?.name ?? 'Other'; }
  private yearsAgo(days: string[], years: number): string {
    const d = new Date(days[days.length - 1] + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.toISOString().slice(0, 10);
  }

  // ── view 0 · growth ───────────────────────────────────────────────────────
  readonly gwins: { key: Win; label: string }[] = [
    { key: 'since', label: 'Since you started' }, { key: '1y', label: '1Y' }, { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' },
  ];
  /** a growth window is offered when the estate is older than it (90% of it) */
  gwinOk(w: Win): boolean {
    const p = this.m()?.portfolio; if (!p) return false;
    if (w === 'since') return true;
    return p.value.length / 248 >= (w === '1y' ? 1 : w === '3y' ? 3 : 5) * 0.9;
  }
  readonly gpts = computed(() => {
    const m = this.m(), p = m?.portfolio; if (!m || !p) return null;
    const w = this.gwin();
    const start = w === 'since' ? m.days[p.from] : this.yearsAgo(m.days, w === '1y' ? 1 : w === '3y' ? 3 : 5);
    const dates: string[] = [], value: number[] = [], invested: number[] = [];
    for (let i = 0; i < p.value.length; i++) {
      const d = m.days[p.from + i]; if (d < start) continue;
      dates.push(d); value.push(p.value[i]); invested.push(p.invested[i]);
    }
    return { dates, value, invested };
  });
  readonly growth = computed<Growth | null>(() => {
    const g = this.gpts(); if (!g || g.value.length < 2) return null;
    const vals = [...g.value, ...g.invested].filter((v) => v > 0);
    let min = Math.min(...vals), max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.12, max * 0.015); min = Math.max(0, min - pad); max += pad;
    const n = g.value.length;
    const X = (i: number) => (i / (n - 1)) * W;
    const Y = (v: number) => H - ((v - min) / (max - min)) * H;
    let value = '', pen = false;
    g.value.forEach((v, i) => { if (!v) { pen = false; return; } value += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    // invested is a staircase: flat until the next purchase lands
    let invested = `M0 ${Y(g.invested[0]).toFixed(1)}`;
    for (let i = 1; i < n; i++) {
      if (g.invested[i] !== g.invested[i - 1]) invested += `L${X(i).toFixed(1)} ${Y(g.invested[i - 1]).toFixed(1)}L${X(i).toFixed(1)} ${Y(g.invested[i]).toFixed(1)}`;
    }
    invested += `L${W} ${Y(g.invested[n - 1]).toFixed(1)}`;
    return { value, area: value + `L${W} ${H}L0 ${H}Z`, invested, n, start: g.dates[0], end: g.dates[n - 1], min, max };
  });
  /** the growth readout: at the scrub point, else now (= the live headline figures) */
  readonly gread = computed(() => {
    const g = this.gpts(); if (!g || !g.value.length) return null;
    const scrubbing = this.gscrub() != null;
    const i = this.gscrub() ?? g.value.length - 1;
    const value = scrubbing ? g.value[i] : this.est.estateValue;
    const invested = scrubbing ? g.invested[i] : this.est.invested;
    const gain = value - invested;
    return { date: g.dates[i], value, invested, gain, pct: invested > 0 ? gain / invested * 100 : 0,
             x: (i / Math.max(1, g.value.length - 1)) * W, scrubbing, since: g.dates[0] };
  });
  /** the growth over the chosen window: value now vs value at the window's start (plus money added since) */
  readonly gwinStat = computed(() => {
    const g = this.gpts(); if (!g || g.value.length < 2) return null;
    const added = g.invested[g.invested.length - 1] - g.invested[0];
    const gain = (g.value[g.value.length - 1] - g.value[0]) - added;
    const base = g.value[0] + Math.max(0, added);
    return { gain, pct: base > 0 ? gain / base * 100 : 0, added };
  });

  // ── view 1 · today ────────────────────────────────────────────────────────
  readonly total = computed(() => this.m()?.total ?? null);
  readonly down = computed(() => (this.total()?.change ?? 0) < 0);
  readonly todayRows = computed<TodayRow[]>(() => {
    const m = this.m(); if (!m) return [];
    const rows = m.funds.filter((f) => f.day_change != null);
    const max = Math.max(0.05, ...rows.map((f) => Math.abs(f.day_pct ?? 0)), ...rows.map((f) => Math.abs(f.bench?.day_pct ?? 0)));
    return rows.map((f) => ({
      key: f.scheme_code, name: f.short, color: this.color(f.sleeve), sleeve: f.sleeve,
      change: f.day_change, pct: f.day_pct,
      bench: f.bench?.name ?? '', benchPct: f.bench?.day_pct ?? null, benchPending: !!f.bench && f.bench.day_pct == null,
      // bars take at most 34% of the track each side, so the % label always fits past the bar's end
      wF: Math.abs(f.day_pct ?? 0) / max * 34, wB: Math.abs(f.bench?.day_pct ?? 0) / max * 34,
      nav: f.nav, prev: f.prev_nav, late: !!m.nav_date && !!f.nav_date && f.nav_date < m.nav_date, when: this.dayShort(f.nav_date),
    })).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  });
  /** "3 of 5 funds beat their index" — only over funds whose index close is in. */
  readonly beat = computed(() => {
    const rows = this.todayRows().filter((r) => r.benchPct != null && r.pct != null);
    return { n: rows.filter((r) => r.pct! >= r.benchPct!).length, of: rows.length, pending: this.todayRows().filter((r) => r.benchPending).length };
  });
  readonly story = computed(() => {
    const t = this.total(); const b = this.beat(); const rows = this.todayRows();
    if (!t || t.change == null || !rows.length) return '';
    const lead = rows[0], tail = rows[rows.length - 1];
    let s = t.change >= 0 ? `${lead.name} led the day` : `${tail.name} weighed most`;
    if (b.of) s += ` · ${b.n} of ${b.of} fund${b.of === 1 ? '' : 's'} beat ${b.of === 1 ? 'its' : 'their'} index`;
    else if (b.pending) s += ' · index closes come in overnight';
    return s + '.';
  });

  // ── view 2 · vs index ─────────────────────────────────────────────────────
  readonly fund = computed<FundMove | null>(() => {
    const m = this.m(); if (!m) return null;
    return m.funds.find((f) => f.scheme_code === this.pick()) ?? m.funds[0] ?? null;
  });
  private winStart(w: Win, f: FundMove, days: string[]): string {
    const first = days[f.from] ?? '';
    if (w === 'since') return f.since && f.since > first ? f.since : first;
    return this.yearsAgo(days, w === '1y' ? 1 : w === '3y' ? 3 : 5);
  }
  /** a window is offered only when the fund's history reaches back that far (90% of it) */
  winOk(w: Win): boolean {
    const m = this.m(), f = this.fund(); if (!m || !f) return false;
    if (w === 'since') return !!f.since;
    const years = w === '1y' ? 1 : w === '3y' ? 3 : 5;
    return f.nav_series.length / 248 >= years * 0.9;
  }
  readonly wins: { key: Win; label: string }[] = [
    { key: 'since', label: 'Since you bought' }, { key: '1y', label: '1Y' }, { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' },
  ];
  /** the window's aligned points: dates, fund and index values (index may be null early on) */
  readonly pts = computed(() => {
    const m = this.m(), f = this.fund(); if (!m || !f) return null;
    const start = this.winStart(this.win(), f, m.days);
    let i0 = 0;
    while (i0 < f.nav_series.length && m.days[f.from + i0] < start) i0++;
    if (i0 >= f.nav_series.length - 1) i0 = Math.max(0, f.nav_series.length - 2);
    const dates: string[] = [], fund: number[] = [], index: (number | null)[] = [];
    for (let i = i0; i < f.nav_series.length; i++) {
      const v = f.nav_series[i]; if (v == null) continue;
      dates.push(m.days[f.from + i]); fund.push(v); index.push(f.index_series[i]);
    }
    return { dates, fund, index };
  });
  readonly line = computed<Line | null>(() => {
    const p = this.pts(); if (!p || p.fund.length < 2) return null;
    const f0 = p.fund[0];
    const i0 = p.index.find((v) => v != null) ?? null;
    const F = p.fund.map((v) => v / f0 * 100);
    const I = p.index.map((v) => (v != null && i0 ? v / i0 * 100 : null));
    const vals = [...F, ...I.filter((v): v is number => v != null)];
    let min = Math.min(...vals), max = Math.max(...vals);
    const pad = Math.max(1.5, (max - min) * 0.08); min -= pad; max += pad;
    const n = F.length;
    const X = (i: number) => (i / (n - 1)) * W;
    const Y = (v: number) => H - ((v - min) / (max - min)) * H;
    const path = (arr: (number | null)[]) => {
      let d = '', pen = false;
      arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      return d;
    };
    const fund = path(F);
    const lastI = [...I].reverse().find((v) => v != null) ?? null;
    return {
      fund, index: path(I),
      area: fund + `L${W} ${H}L0 ${H}Z`,
      base: Y(100), n, start: p.dates[0], end: p.dates[n - 1],
      fundEnd: F[n - 1] - 100, indexEnd: lastI != null ? lastI - 100 : NaN, min, max,
    };
  });
  /** the readout: at the scrub point, else the window's end */
  readonly read = computed(() => {
    const p = this.pts(), l = this.line(); if (!p || !l) return null;
    const i = this.scrub() ?? p.fund.length - 1;
    const i0 = p.index.find((v) => v != null) ?? null;
    const fundPct = p.fund[i] / p.fund[0] * 100 - 100;
    const iv = p.index[i];
    const indexPct = iv != null && i0 ? iv / i0 * 100 - 100 : null;
    return { date: p.dates[i], fundPct, indexPct, gap: indexPct == null ? null : fundPct - indexPct,
             x: (i / (p.fund.length - 1)) * W, scrubbing: this.scrub() != null };
  });
  readonly bars = computed<Bars | null>(() => {
    const p = this.pts(); if (!p || p.fund.length < 3) return null;
    // daily % moves; folded into weeks / months when there are too many to see
    const daily: { d: string; r: number }[] = [];
    for (let i = 1; i < p.fund.length; i++) daily.push({ d: p.dates[i], r: p.fund[i] / p.fund[i - 1] - 1 });
    const per: Bars['per'] = daily.length <= 130 ? 'day' : daily.length <= 650 ? 'week' : 'month';
    const key = (d: string) => per === 'day' ? d : per === 'month' ? d.slice(0, 7) : this.weekKey(d);
    const groups: { k: string; r: number }[] = [];
    for (const x of daily) {
      const k = key(x.d);
      const g = groups[groups.length - 1];
      if (g && g.k === k) g.r = (1 + g.r) * (1 + x.r) - 1; else groups.push({ k, r: x.r });
    }
    const n = groups.length;
    const maxAbs = Math.max(0.001, ...groups.map((g) => Math.abs(g.r)));
    const w = Math.max(1, Math.min(8, (W / n) * 0.72));
    const zero = BH / 2;
    const bars = groups.map((g, i) => {
      const h = Math.max(1, (Math.abs(g.r) / maxAbs) * (BH / 2 - 2));
      return { x: (i + 0.5) / n * W - w / 2, y: g.r >= 0 ? zero - h : zero, h, up: g.r >= 0 };
    });
    const best = Math.max(...daily.map((x) => x.r)) * 100, worst = Math.min(...daily.map((x) => x.r)) * 100;
    const ups = daily.filter((x) => x.r > 0).length;
    const bi = daily.reduce((a, x, i) => (x.r > daily[a].r ? i : a), 0);
    return { bars, w, zero, per, best, worst, ups, total: daily.length, idx: daily[bi].d };
  });
  private weekKey(d: string): string {
    const t = new Date(d + 'T00:00:00Z'); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day);
    return t.toISOString().slice(0, 10);
  }

  // ── scrubbing ─────────────────────────────────────────────────────────────
  private frac(ev: PointerEvent, svg: Element): number {
    const r = (svg as SVGSVGElement).getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  }
  onScrub(ev: PointerEvent, svg: Element): void {
    const p = this.pts(); if (!p) return;
    this.scrub.set(Math.round(this.frac(ev, svg) * (p.fund.length - 1)));
  }
  endScrub(): void { this.scrub.set(null); }
  onGscrub(ev: PointerEvent, svg: Element): void {
    const g = this.gpts(); if (!g) return;
    this.gscrub.set(Math.round(this.frac(ev, svg) * (g.value.length - 1)));
  }
  endGscrub(): void { this.gscrub.set(null); }

  trackRow(_: number, r: TodayRow): number { return r.key; }
  trackFund(_: number, f: FundMove): number { return f.scheme_code; }
}
