import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';

import { EstateService, FundMove, FundMoves } from '../estate.service';
import { inr } from '../shared/format.util';

type Range = '1m' | '3m' | 'all';
const RANGES: { k: Range; l: string; n: number }[] = [
  { k: '1m', l: '1M', n: 22 }, { k: '3m', l: '3M', n: 66 }, { k: 'all', l: 'Since start', n: 1e9 },
];
const W = 320, H = 110, BH = 92;

/** one trading day of the estate: its ₹ move (cash flows taken out), its %, the indices' % */
interface Day { d: string; g: number; chg: number; pct: number; idx: number | null; }
/** one fund on one day: its ₹ and % move, and its own index's % that day */
interface DayFund { key: number; name: string; chg: number | null; pct: number | null; bench: string | null; bpct: number | null; gap: number | null; }

/**
 * "Your day vs the index" — a hidden sheet (three quick taps anywhere on the home).
 * Everything follows ONE picked day (the latest NAV day by default):
 *   1. the day: −₹5,071 (−0.52%) against the same day for your funds' indices, with a verdict
 *   2. history (1M / 3M / since start): every day's gain / loss as bars with the index's day as a
 *      tick — tap a bar, or step with ‹ ›, to pick a day; and growth since the window opened
 *   3. fund by fund FOR THAT DAY: each fund's move next to its own index's move
 * The index for the estate is each fund's own index, weighted by what the client holds.
 * Data: GET /me/funds/moves (cached by EstateService).
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
  readonly RANGES = RANGES;
  readonly W = W; readonly H = H; readonly BH = BH;

  private readonly _open = signal(false);
  @Input() set open(v: boolean) { this._open.set(!!v); if (v) { this.est.loadMoves(); this.pick.set(null); } }
  get open(): boolean { return this._open(); }
  @Output() closed = new EventEmitter<void>();
  readonly isOpen = computed(() => this._open());
  close(): void { this._open.set(false); this.closed.emit(); }
  @HostListener('document:keydown.escape') onEsc(): void { if (this._open()) this.close(); }

  readonly m = computed<FundMoves | null>(() => this.est.moves());
  readonly range = signal<Range>('1m');
  /** the picked day (index into days()), null = the latest */
  readonly pick = signal<number | null>(null);

  // ── every trading day since the first purchase ──
  readonly allDays = computed<Day[]>(() => {
    const m = this.m(); const p = m?.portfolio; if (!m || !p) return [];
    const out: Day[] = [];
    for (let k = 1; k < p.value.length; k++) {
      const v0 = p.value[k - 1], v1 = p.value[k];
      if (!v0) continue;
      const chg = (v1 - v0) - (p.invested[k] - p.invested[k - 1]);       // money added that day is not a gain
      const g = p.from + k;
      out.push({ d: m.days[g], g, chg, pct: chg / v0 * 100, idx: this.idxOn(m, g) });
    }
    return out;
  });
  /** the funds' indices on day g, weighted by what the client holds */
  private idxOn(m: FundMoves, g: number): number | null {
    let w = 0, s = 0;
    for (const f of m.funds as FundMove[]) {
      const i = g - f.from, a = f.index_series[i - 1], b = f.index_series[i];
      if (i < 1 || a == null || b == null || !a || a === b || !f.weight) continue;   // an unchanged close = not published yet
      w += f.weight; s += f.weight * (b / a - 1) * 100;
    }
    if (!w && m.days[g] === m.nav_date) return this.idxToday(m);          // the newest day: the live index moves
    return w ? s / w : null;
  }
  private idxToday(m: FundMoves): number | null {
    let w = 0, s = 0;
    for (const f of m.funds) { const b = f.bench?.day_pct; if (b == null || !f.value) continue; w += f.value; s += f.value * b; }
    return w ? s / w : null;
  }
  readonly days = computed<Day[]>(() => {
    const n = RANGES.find((r) => r.k === this.range())!.n, all = this.allDays();
    return all.slice(Math.max(0, all.length - n));
  });
  setRange(r: Range): void { this.range.set(r); this.pick.set(null); }

  // ── the picked day ──
  readonly sel = computed(() => {
    const ds = this.days(); if (!ds.length) return null;
    const i = Math.min(this.pick() ?? ds.length - 1, ds.length - 1);
    return { ...ds[i], i, first: i === 0, last: i === ds.length - 1 };
  });
  /** the day before the picked one (for "NAV of … vs …") */
  readonly prevDay = computed(() => { const s = this.sel(), m = this.m(); return s && m ? m.days[s.g - 1] ?? null : null; });
  readonly isLatest = computed(() => { const s = this.sel(), m = this.m(); return !!s && !!m && s.d === m.nav_date; });
  /** the day's figures: the newest day uses the server's own total, older days the series */
  readonly change = computed(() => { const s = this.sel(), m = this.m(); return !s ? null : this.isLatest() ? (m!.total.change ?? s.chg) : s.chg; });
  readonly pct = computed(() => { const s = this.sel(), m = this.m(); return !s ? null : this.isLatest() ? (m!.total.pct ?? s.pct) : s.pct; });
  readonly idx = computed(() => this.sel()?.idx ?? null);
  readonly gap = computed(() => { const a = this.pct(), b = this.idx(); return a == null || b == null ? null : a - b; });
  readonly dayBars = computed(() => {
    const a = this.pct(), b = this.idx();
    const sc = Math.max(0.1, Math.abs(a ?? 0), Math.abs(b ?? 0));
    return { mine: Math.abs(a ?? 0) / sc * 100, idx: Math.abs(b ?? 0) / sc * 100 };
  });
  step(d: number): void {
    const ds = this.days(); if (!ds.length) return;
    const i = Math.min(this.pick() ?? ds.length - 1, ds.length - 1) + d;
    if (i < 0 || i >= ds.length) return;
    this.pick.set(i); if (navigator.vibrate) navigator.vibrate(3);
  }
  onPick(ev: PointerEvent, el: Element): void {
    const n = this.days().length; if (!n) return;
    const r = el.getBoundingClientRect();
    this.pick.set(Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) / r.width) * n))));
  }

  // ── history ──
  /** the window's totals: ₹ gained, your %, the indices' % */
  readonly win = computed(() => {
    const ds = this.days(); if (!ds.length) return null;
    let mine = 1, idx = 1, chg = 0;
    for (const d of ds) { mine *= 1 + d.pct / 100; if (d.idx != null) idx *= 1 + d.idx / 100; chg += d.chg; }
    return { chg, mine: (mine - 1) * 100, idx: (idx - 1) * 100, from: ds[0].d, to: ds[ds.length - 1].d, n: ds.length };
  });
  /** two lines: growth since the window opened, yours and the indices' */
  readonly lines = computed(() => {
    const ds = this.days(); if (ds.length < 2) return null;
    let a = 1, b = 1; const A = [0], B = [0];
    for (const d of ds) { a *= 1 + d.pct / 100; b *= 1 + (d.idx ?? 0) / 100; A.push((a - 1) * 100); B.push((b - 1) * 100); }
    const lo = Math.min(0, ...A, ...B), hi = Math.max(0, ...A, ...B), pad = (hi - lo) * 0.1 || 0.5;
    const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16);
    const x = (i: number) => (i / (A.length - 1)) * W;
    const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const s = this.sel(); const sx = s ? x(s.i + 1) : null;
    return { mine: path(A), idx: path(B), zero: y(0), sx, syMine: s ? y(A[s.i + 1]) : null, syIdx: s ? y(B[s.i + 1]) : null };
  });
  /** the daily bars: your day (green / red) with the index's day as a tick */
  readonly bars = computed(() => {
    const ds = this.days(); if (!ds.length) return null;
    const sc = Math.max(0.05, ...ds.map((d) => Math.abs(d.pct)), ...ds.map((d) => Math.abs(d.idx ?? 0)));
    const n = ds.length, slot = W / n, bw = Math.max(1.2, Math.min(9, slot * 0.62)), mid = BH / 2;
    const yOf = (v: number) => mid - (v / sc) * (mid - 4);
    return { mid, bw, slot, items: ds.map((d, i) => {
      const cx = (i + 0.5) * slot, h = Math.max(1, Math.abs(yOf(d.pct) - mid));
      return { x: cx - bw / 2, cx, y: d.pct >= 0 ? mid - h : mid, h, up: d.pct >= 0, tick: d.idx == null ? null : yOf(d.idx) };
    }) };
  });
  readonly upDays = computed(() => this.days().filter((d) => d.chg > 0).length);
  readonly beatDays = computed(() => this.days().filter((d) => d.idx != null && d.pct > d.idx).length);

  // ── fund by fund, for the picked day ──
  readonly dayFunds = computed<DayFund[]>(() => {
    const m = this.m(), s = this.sel(); if (!m || !s) return [];
    const latest = this.isLatest();
    const rows: DayFund[] = [];
    for (const f of m.funds as FundMove[]) {
      const i = s.g - f.from;
      let chg: number | null = null, pct: number | null = null, bpct: number | null = null;
      const a = i >= 1 ? f.nav_series[i - 1] : null, b = i >= 1 ? f.nav_series[i] : null;
      if (a && b != null) { pct = (b / a - 1) * 100; chg = f.units * (b - a); }
      else if (latest && f.nav_date === m.nav_date) { chg = f.day_change; pct = f.day_pct; }
      const ia = i >= 1 ? f.index_series[i - 1] : null, ib = i >= 1 ? f.index_series[i] : null;
      if (ia && ib != null && ia !== ib) bpct = (ib / ia - 1) * 100;
      else if (latest && f.bench?.day_pct != null) bpct = f.bench.day_pct;
      if (chg == null && pct == null) continue;                             // not held yet that day
      rows.push({ key: f.scheme_code, name: f.short, chg, pct, bench: f.bench?.name ?? null, bpct,
                  gap: pct != null && bpct != null ? pct - bpct : null });
    }
    return rows.sort((a, b) => Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0));
  });
  /** the fund rows' mini bars share one scale */
  readonly fundScale = computed(() => Math.max(0.1, ...this.dayFunds().flatMap((f) => [Math.abs(f.pct ?? 0), Math.abs(f.bpct ?? 0)])));
  w(v: number | null): number { return v == null ? 0 : Math.abs(v) / this.fundScale() * 100; }

  // ── words ──
  /** "−₹5,071 (−0.52%)" */
  amt(chg: number | null | undefined, pct: number | null | undefined): string {
    if (chg == null) return pct == null ? '—' : this.p(pct);
    const s = (chg < 0 ? '−' : '+') + inr(Math.abs(Math.round(chg)));
    return pct == null ? s : `${s} (${this.p(pct)})`;
  }
  p(v: number | null | undefined, dp = 2): string { return v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp) + '%'; }
  pts(v: number): string { return Math.abs(v).toFixed(2) + ' pts'; }
  dayShort(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  date(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  dayWhen(iso: string | null | undefined): string {
    if (!iso) return 'Today';
    const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    if (iso === ist(Date.now())) return 'Today';
    if (iso === ist(Date.now() - 86_400_000)) return 'Yesterday';
    return this.dayShort(iso);
  }
  tone(v: number | null | undefined): 'up' | 'dn' | '' { return v == null ? '' : v > 0.0001 ? 'up' : v < -0.0001 ? 'dn' : ''; }
}
