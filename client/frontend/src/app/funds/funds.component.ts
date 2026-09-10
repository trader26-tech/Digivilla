import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService, FundsBreakdown, FundRow } from '../estate.service';
import { compact } from '../shared/format.util';

/** A rung on the estate ladder (mirrors the design template). */
interface Level { level: number; name: string; tagline: string; threshold: number; }

/**
 * The Funds tab — the client's full portfolio, bit by bit.
 *
 * Three parts, top to bottom:
 *   1. A motivating "top X% of investors in India" badge + a level ladder
 *      (Plot → Levelled Ground → Foundation → Steel Frame → Villa), driven by
 *      how much they hold, nudging them to invest more.
 *   2. The headline numbers: worth, invested, gain, SWP.
 *   3. A fund-by-fund breakdown — each fund's allocation, the money in it, and
 *      live 1/3/5-year returns, so they see exactly how each fund performs.
 */
@Component({
  selector: 'app-funds',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './funds.component.html',
  styleUrl: './funds.component.scss',
})
export class FundsComponent implements OnInit {
  private est = inject(EstateService);
  compact = compact;

  data = signal<FundsBreakdown | null>(null);
  loading = signal(true);
  /** which return window is shown on each fund: 1y | 3y | 5y */
  window = signal<'1y' | '3y' | '5y'>('1y');

  ngOnInit(): void {
    this.est.myFunds().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  get worth(): number { return this.data()?.worth ?? this.est.estateValue; }
  get invested(): number { return this.data()?.invested ?? this.est.invested; }
  get gain(): number { return this.data()?.gain ?? this.est.gain; }
  get gainPct(): number { return this.data()?.gain_pct ?? 0; }
  get funds(): FundRow[] { return this.data()?.funds ?? []; }
  get overall() { return this.data()?.overall ?? { ret_1y: null, ret_3y: null, ret_5y: null }; }

  /** The return shown for a fund in the currently-selected window. */
  ret(f: FundRow): number | null {
    return this.window() === '1y' ? f.ret_1y : this.window() === '3y' ? f.ret_3y : f.ret_5y;
  }
  overallRet(): number | null {
    const o = this.overall;
    return this.window() === '1y' ? o.ret_1y : this.window() === '3y' ? o.ret_3y : o.ret_5y;
  }
  setWindow(w: '1y' | '3y' | '5y'): void { this.window.set(w); if (navigator.vibrate) navigator.vibrate(3); }

  // ── motivation: where this investor ranks (illustrative tiers by amount) ──
  private readonly TIERS = [
    { min: 5_000_000, pct: 'Top 1%',  line: 'You’re among the top 1% of investors in India.' },
    { min: 2_500_000, pct: 'Top 3%',  line: 'You’re in the top 3% of investors in India.' },
    { min: 1_000_000, pct: 'Top 5%',  line: 'You’re in the top 5% of investors in India.' },
    { min: 500_000,   pct: 'Top 10%', line: 'You’re in the top 10% of investors in India.' },
    { min: 100_000,   pct: 'Top 20%', line: 'You’re ahead of 80% of Indians who don’t invest at all.' },
    { min: 0,         pct: 'Getting started', line: 'Start your estate — most Indians never invest at all.' },
  ];
  tier = computed(() => this.TIERS.find((t) => this.worth >= t.min) || this.TIERS[this.TIERS.length - 1]);
  /** The next tier up + how much more to reach it — the nudge to invest more. */
  nextTier = computed(() => {
    const i = this.TIERS.findIndex((t) => this.worth >= t.min);
    if (i <= 0) return null;                        // already top 1%
    const up = this.TIERS[i - 1];
    return { pct: up.pct, gap: up.min - this.worth };
  });

  // ── the estate level ladder (₹1L per level, villa complete at ₹5L) ──
  private readonly LEVELS: Level[] = [
    { level: 1, name: 'The Plot',        tagline: 'Land in your name — 100% equity, valued at NAV.',   threshold: 100_000 },
    { level: 2, name: 'Levelled Ground', tagline: 'The site is cleared and graded. Your money is working.', threshold: 200_000 },
    { level: 3, name: 'Foundation',      tagline: 'Concrete poured — halfway to the villa.',            threshold: 300_000 },
    { level: 4, name: 'Steel Frame',     tagline: 'Columns and beams up. One level to go.',             threshold: 400_000 },
    { level: 5, name: 'The Villa',       tagline: 'Complete — monthly income arrives by SWP.',          threshold: 500_000 },
  ];
  levels = computed(() => this.LEVELS);
  currentLevel = computed(() => Math.max(1, Math.min(5, Math.floor(this.worth / 100_000) + 1)));
  /** progress 0..1 within the current level. */
  levelProgress = computed(() => {
    const lv = this.currentLevel();
    const start = (lv - 1) * 100_000;
    return Math.max(0, Math.min(1, (this.worth - start) / 100_000));
  });
  /** ₹ to the next level — the nudge. */
  toNextLevel = computed(() => {
    const lv = this.currentLevel();
    if (lv >= 5) return 0;
    return Math.max(0, lv * 100_000 - this.worth);
  });
  levelState(l: Level): 'done' | 'current' | 'locked' {
    const c = this.currentLevel();
    return l.level < c ? 'done' : l.level === c ? 'current' : 'locked';
  }
}
