import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';

import { EstateService, FundMove, FundMoves } from '../estate.service';
import { inr } from '../shared/format.util';

type Range = '1m' | '3m' | '6m' | '1y' | 'all';
const RANGES: { k: Range; l: string; n: number; words: string }[] = [
  { k: '1m', l: '1M', n: 22, words: 'Last month' }, { k: '3m', l: '3M', n: 66, words: 'Last 3 months' }, { k: '6m', l: '6M', n: 132, words: 'Last 6 months' },
  { k: '1y', l: '1Y', n: 252, words: 'Last 12 months' }, { k: 'all', l: 'All', n: 1e9, words: 'Since you started' },
];
const W = 300, H = 110, BASE = 100_000;

/** one trading day inside the window: your % (cash flows taken out) and the indices' % */
interface Day { d: string; g: number; pct: number; idx: number | null; chg: number; }

/**
 * Investments — the handoff's second screen. Current value, then your portfolio against
 * the right index over a range (both drawn as the growth of ₹1,00,000), when the figures
 * were last published, and every fund with its own index beside it.
 *   · "the index" = each fund's own benchmark (Nifty 50 / Midcap 150 / Smallcap 250 / Gold /
 *     Nifty 50 Arbitrage…) weighted by what the client holds — not one index for everything.
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
  @Output() back = new EventEmitter<void>();

  constructor() { this.est.loadMoves(); }

  readonly m = computed<FundMoves | null>(() => this.est.moves());
  readonly wanted = signal<Range>('1y');
  /** the range in use: what was tapped, else the longest the history can fill */
  readonly range = computed<Range>(() => { const rs = this.ranges(); return rs.some((r) => r.k === this.wanted()) ? this.wanted() : rs[rs.length - 1].k; });
  readonly rangeWords = computed(() => RANGES.find((r) => r.k === this.range())!.words);
  setRange(r: Range): void { this.wanted.set(r); this.scrub.set(null); if (navigator.vibrate) navigator.vibrate(3); }

  // ── the headline ──
  get value(): number { return this.est.estateValue; }
  get invested(): number { return this.est.invested; }

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
  private idxOn(m: FundMoves, g: number): number | null {
    let w = 0, s = 0;
    for (const f of m.funds as FundMove[]) {
      const i = g - f.from, a = f.index_series[i - 1], b = f.index_series[i];
      if (i < 1 || a == null || b == null || !a || a === b || !f.weight) continue;
      w += f.weight; s += f.weight * (b / a - 1) * 100;
    }
    if (!w && m.days[g] === m.nav_date) {                                   // the newest day: the live index moves
      let wv = 0, sv = 0;
      for (const f of m.funds) { const b = f.bench?.day_pct; if (b == null || !f.value) continue; wv += f.value; sv += f.value * b; }
      return wv ? sv / wv : null;
    }
    return w ? s / w : null;
  }
  readonly days = computed<Day[]>(() => {
    const n = RANGES.find((r) => r.k === this.range())!.n, all = this.allDays();
    return all.slice(Math.max(0, all.length - n));
  });
  /** ranges the history can actually fill (a 2-month-old estate has no 1Y) */
  readonly ranges = computed(() => { const n = this.allDays().length; return RANGES.filter((r, i) => i === 0 || r.k === 'all' || n > RANGES[i - 1].n); });

  // ── you vs the index over the window ──
  readonly growth = computed(() => {
    const ds = this.days(); if (!ds.length) return null;
    let a = 1, b = 1, chg = 0; const A = [1], B = [1];
    for (const d of ds) { a *= 1 + d.pct / 100; b *= 1 + (d.idx ?? 0) / 100; chg += d.chg; A.push(a); B.push(b); }
    // the % on the money actually in (differs from the time-weighted line when money came in mid-window)
    const m = this.m()!, p = m.portfolio!, k1 = ds[ds.length - 1].g - p.from, k0 = ds[0].g - p.from - 1;
    const base = Math.max(p.value[k0] ?? 0, 0) + Math.max(0, (p.invested[k1] ?? 0) - (p.invested[k0] ?? 0));
    const mwr = base > 0 ? chg / base * 100 : null;
    return { mine: (a - 1) * 100, idx: (b - 1) * 100, chg, mwr: Math.abs((mwr ?? 0) - (a - 1) * 100) < 0.05 ? null : mwr, A, B, from: ds[0].d, to: ds[ds.length - 1].d, lead: (a - b) * 100 };
  });
  /** the two lines + the area under yours, as the growth of ₹1,00,000 */
  readonly chart = computed(() => {
    const g = this.growth(); if (!g || g.A.length < 2) return null;
    const vals = [...g.A, ...g.B];
    const lo = Math.min(1, ...vals), hi = Math.max(1, ...vals), pad = (hi - lo) * 0.12 || 0.01;
    const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16);
    const x = (i: number) => (i / (g.A.length - 1)) * W;
    const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const mine = path(g.A), idx = path(g.B);
    return { mine, idx, area: `${mine} L${W} ${H} L0 ${H} Z`, zero: y(1), endMine: y(g.A[g.A.length - 1]), endIdx: y(g.B[g.B.length - 1]), x, y };
  });
  /** finger on the chart: the day under it */
  readonly scrub = signal<number | null>(null);
  onScrub(ev: PointerEvent, el: Element): void {
    const g = this.growth(); if (!g) return;
    const r = el.getBoundingClientRect();
    this.scrub.set(Math.max(0, Math.min(g.A.length - 1, Math.round(((ev.clientX - r.left) / r.width) * (g.A.length - 1)))));
  }
  readonly scrubAt = computed(() => {
    const g = this.growth(), c = this.chart(), i = this.scrub(); if (!g || !c || i == null) return null;
    const ds = this.days();
    return { d: i === 0 ? ds[0].d : ds[i - 1].d, mine: g.A[i] * BASE, idx: g.B[i] * BASE, x: c.x(i), yMine: c.y(g.A[i]), yIdx: c.y(g.B[i]) };
  });
  /** the index's name: one fund's own, or "your indices" when they differ */
  readonly indexName = computed(() => {
    const names = [...new Set((this.m()?.funds ?? []).filter((f) => f.value > 0 && f.bench).map((f) => f.bench!.name))];
    return names.length === 1 ? names[0] : 'Your indices';
  });
  readonly indexNote = computed(() => this.indexName() === 'Your indices' ? 'each fund’s own index, weighted by what you hold' : null);
  readonly BASE = BASE;

  // ── when the figures were published, and when the next ones come ──
  readonly timing = computed(() => {
    const m = this.m(); if (!m?.nav_date) return null;
    const ist = (ms: number) => new Date(ms + 330 * 60_000);
    const today = ist(Date.now()).toISOString().slice(0, 10);
    const nav = m.nav_date;
    const when = nav === today ? 'Today' : nav === ist(Date.now() - 86_400_000).toISOString().slice(0, 10) ? 'Yesterday' : this.day(nav);
    // the next NAV day: the next weekday after the published one
    const d = new Date(nav + 'T00:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    const next = d.toISOString().slice(0, 10);
    const nextWhen = next === today ? 'Tonight' : next === ist(Date.now() + 86_400_000).toISOString().slice(0, 10) ? 'Tomorrow' : this.day(next);
    return { when, nav: this.day(nav), nextWhen, next: this.day(next), late: next < today };
  });

  // ── fund by fund over the window ──
  readonly funds = computed(() => {
    const m = this.m(), ds = this.days(); if (!m) return [];
    const total = m.funds.reduce((s, f) => s + (f.value || 0), 0) || 1;
    const g0 = ds.length ? ds[0].g - 1 : null;                          // the close the window starts from
    return (m.funds as FundMove[]).filter((f) => f.value > 0 || f.invested > 0).map((f) => {
      let ret: number | null = null, iret: number | null = null, since: string | null = null;
      if (g0 != null && f.nav_series.length > 1) {
        let i0 = Math.max(0, g0 - f.from);                                 // the fund may have started inside the window
        while (i0 < f.nav_series.length - 1 && f.nav_series[i0] == null) i0++;
        const n0 = f.nav_series[i0], n1 = f.nav_series[f.nav_series.length - 1] ?? f.nav;
        if (n0 && n1) ret = (n1 / n0 - 1) * 100;
        if (g0 - f.from < 0) since = m.days[f.from + i0];
        let j0 = i0; while (j0 < f.index_series.length - 1 && f.index_series[j0] == null) j0++;
        let j1 = f.index_series.length - 1; while (j1 > j0 && f.index_series[j1] == null) j1--;
        const x0 = f.index_series[j0], x1 = f.index_series[j1];
        if (x0 && x1 && j1 > j0) iret = (x1 / x0 - 1) * 100;
      }
      return { key: f.scheme_code, name: f.short || f.name, sleeve: this.sleeveName(f.sleeve), bench: f.bench?.name ?? null,
               share: f.value / total * 100, invested: f.invested, value: f.value, pnl: f.value - f.invested, ret, iret,
               gap: ret != null && iret != null ? ret - iret : null, since };
    }).sort((a, b) => b.value - a.value);
  });
  private sleeveName(s: string): string {
    return ({ arbitrage: 'Arbitrage', gold: 'Gold', large: 'Large cap', mid: 'Mid cap', small: 'Small cap', flexi: 'Flexi cap', hybrid: 'Hybrid', debt: 'Debt' } as Record<string, string>)[s] || s || 'Fund';
  }

  // ── words ──
  inr = inr;
  p(v: number | null | undefined, dp = 1): string { return v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp) + '%'; }
  signed(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−' : '+') + inr(Math.abs(Math.round(v))); }
  pts(v: number): string { return Math.abs(v).toFixed(1) + ' points'; }
  day(iso: string | null | undefined): string { return iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; }
  tone(v: number | null | undefined): 'gain' | 'loss' | '' { return v == null ? '' : v > 0.0001 ? 'gain' : v < -0.0001 ? 'loss' : ''; }
}
