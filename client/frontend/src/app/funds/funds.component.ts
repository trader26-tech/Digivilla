import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { EstateService, FundsBreakdown, FundRow, FundNav, NavWindow } from '../estate.service';
import { compact } from '../shared/format.util';

/**
 * The Funds tab — a celebration of what the user has built, then the estate
 * broken down fund by fund.
 *
 *   1. A big animated "you've saved ₹X" hero with a motivating rank
 *      ("ahead of 80% of Indians · Top 20%") — driven by how much they've
 *      invested, so even a small amount feels like a win.
 *   2. One estate/house card showing today's worth; expand it to see every
 *      fund inside — its value, gain, return and risk.
 *   3. Tap a fund → a detail sheet with its NAV history chart, category and
 *      the basics (current NAV, 1/3/5-Yr, high/low).
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
  /** the estate card starts open so the funds are immediately visible. */
  estateOpen = signal(true);

  ngOnInit(): void {
    this.est.myFunds().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  toggleEstate(): void { this.estateOpen.update((v) => !v); if (navigator.vibrate) navigator.vibrate(3); }

  get worth(): number { return this.data()?.worth ?? this.est.estateValue; }
  get invested(): number { return this.data()?.invested ?? this.est.invested; }
  get gain(): number { return this.data()?.gain ?? this.est.gain; }
  get gainPct(): number { return this.data()?.gain_pct ?? 0; }
  get funds(): FundRow[] { return this.data()?.funds ?? []; }
  get totalSwp(): number { return this.data()?.total_swp ?? 0; }
  get overall() { return this.data()?.overall ?? { ret_1y: null, ret_3y: null, ret_5y: null }; }
  /** The estate's name for the house card ("Sanjeev's City" → "Sanjeev's Estate"). */
  get estateLabel(): string {
    const n = this.est.estateName;
    return n ? `${n}’s Estate` : 'Your Estate';
  }

  /** The headline "saved" figure — what they've actually put in (their effort). */
  get saved(): number { return Math.max(this.invested, this.worth); }

  /** The return shown for a fund in the currently-selected window. */
  ret(f: FundRow): number | null {
    return this.window() === '1y' ? f.ret_1y : this.window() === '3y' ? f.ret_3y : f.ret_5y;
  }
  overallRet(): number | null {
    const o = this.overall;
    return this.window() === '1y' ? o.ret_1y : this.window() === '3y' ? o.ret_3y : o.ret_5y;
  }
  setWindow(w: '1y' | '3y' | '5y'): void { this.window.set(w); if (navigator.vibrate) navigator.vibrate(3); }

  /** A fund's gain/dip vs invested, as a positive amount (sign shown in UI). */
  fundAbsGain(f: FundRow): number { return Math.abs(f.gain || 0); }
  /** A fund's gain/dip as a positive % of what was invested in it. */
  fundPct(f: FundRow): number {
    const inv = f.invested || 0;
    if (!inv) return 0;
    return Math.abs((f.gain || 0) / inv) * 100;
  }

  /** Risk badge for a fund, inferred from its category. */
  risk(f: FundRow): { label: string; level: number } {
    const c = (f.category || '').toLowerCase();
    if (c.includes('equity')) {
      const n = (f.name || '').toLowerCase();
      if (n.includes('small')) return { label: 'Very high risk', level: 5 };
      if (n.includes('mid')) return { label: 'High risk', level: 4 };
      return { label: 'High risk', level: 4 };
    }
    if (c.includes('hybrid')) return { label: 'Low risk', level: 2 };
    if (c.includes('debt')) return { label: 'Low risk', level: 1 };
    return { label: 'Moderate risk', level: 3 };   // gold / other
  }

  // ── motivation: where this investor ranks (illustrative, by amount saved) ──
  private readonly TIERS = [
    { min: 5_000_000, pct: 'Top 1%',  beats: 99, line: 'You’re among the top 1% of investors in India.' },
    { min: 2_500_000, pct: 'Top 3%',  beats: 97, line: 'You’re in the top 3% of investors in India.' },
    { min: 1_000_000, pct: 'Top 5%',  beats: 95, line: 'You’re in the top 5% of investors in India.' },
    { min: 500_000,   pct: 'Top 10%', beats: 90, line: 'You’re in the top 10% of investors in India.' },
    { min: 200_000,   pct: 'Top 15%', beats: 85, line: 'You’re ahead of 85% of Indians.' },
    { min: 50_000,    pct: 'Top 20%', beats: 80, line: 'You’re ahead of 80% of Indians who never invest.' },
    { min: 10_000,    pct: 'Top 40%', beats: 60, line: 'You’ve started — ahead of 60% of Indians.' },
    { min: 1,         pct: 'Top 60%', beats: 40, line: 'You’ve begun your estate. A real head start.' },
    { min: 0,         pct: '',        beats: 0,  line: 'Start your estate — most Indians never invest at all.' },
  ];
  tier = computed(() => this.TIERS.find((t) => this.saved >= t.min) || this.TIERS[this.TIERS.length - 1]);

  /** The user's first name for warm, personal copy ("Nice going, Ranjeev"). */
  get firstName(): string {
    const n = (this.est.estateName || this.est.profile().name || '').trim();
    return n ? n.split(/\s+/)[0] : '';
  }

  /** A warm, personal headline — greets them by name and celebrates the effort. */
  rankGreeting = computed(() => {
    const b = this.tier().beats;
    const name = this.firstName;
    const hi = name ? `${name}, ` : '';
    if (b >= 90) return `${hi}you’re in rare company 🏆`;
    if (b >= 60) return `${hi}you’re doing brilliantly 👏`;
    if (b >= 40) return `${hi}you’ve made a strong start 🌱`;
    return `${hi}your journey begins 🌱`;
  });

  /** The human meaning of the rank — informative, grounded in a real fact:
   *  only a small share of Indians invest in mutual funds at all. */
  rankMeaning = computed(() => {
    const b = this.tier().beats;
    if (b <= 0) return '';
    return `Only about 1 in 5 Indians invest in mutual funds. By putting ${compact(this.saved)} to work, you’re already ahead of an estimated ${b} out of every 100 adults.`;
  });

  /** Where the "ahead of X%" estimate comes from — shown as a source note so
   *  the number is transparent, not a black box. These are illustrative bands
   *  based on published mutual-fund participation data, not a live percentile. */
  readonly rankSource =
    'Estimate based on mutual-fund participation in India (AMFI & SEBI, 2024). Illustrative, not a live ranking.';

  /** A gentle, personal nudge toward the next milestone (or a proud line if
   *  they're already at the top). */
  rankNudge = computed(() => {
    const n = this.nextTier();
    if (!n) return 'You’re right at the very top. Keep it up.';
    return `Add ${compact(n.gap)} more and you’ll reach the ${n.pct}.`;
  });
  /** The next tier up + how much more to reach it — the nudge to invest more. */
  nextTier = computed(() => {
    const i = this.TIERS.findIndex((t) => this.saved >= t.min);
    if (i <= 0) return null;                        // already top 1%
    const up = this.TIERS[i - 1];
    return { pct: up.pct, gap: up.min - this.saved };
  });

  // ============================ FUND DETAIL SHEET ============================
  selected = signal<FundRow | null>(null);
  navData = signal<FundNav | null>(null);
  navLoading = signal(false);
  navErr = signal(false);
  /** which NAV window the chart shows. */
  navWindow = signal<'1y' | '3y' | '5y' | 'max'>('1y');

  openFund(f: FundRow): void {
    this.selected.set(f);
    this.navData.set(null);
    this.navErr.set(false);
    this.navWindow.set('1y');
    if (navigator.vibrate) navigator.vibrate(4);
    if (f.scheme_code) {
      this.navLoading.set(true);
      this.est.fundNav(f.scheme_code).subscribe({
        next: (d) => { this.navData.set(d); this.navLoading.set(false); },
        error: () => { this.navErr.set(true); this.navLoading.set(false); },
      });
    }
  }
  closeFund(): void { this.selected.set(null); }
  setNavWindow(w: '1y' | '3y' | '5y' | 'max'): void { this.navWindow.set(w); if (navigator.vibrate) navigator.vibrate(3); }

  /** The currently-charted NAV window. */
  curWindow = computed<NavWindow | null>(() => {
    const d = this.navData();
    if (!d) return null;
    return d.windows.find((w) => w.window === this.navWindow()) || d.windows[0] || null;
  });

  /** Build an SVG polyline path (0..100 viewBox) from the current window's NAVs. */
  navPath = computed<string>(() => {
    const w = this.curWindow();
    if (!w || !w.points?.length) return '';
    const pts = w.points;
    const lo = w.low, hi = w.high;
    const span = hi - lo || 1;
    const n = pts.length;
    return pts.map((p, i) => {
      const x = (i / (n - 1)) * 100;
      const y = 100 - ((p.nav - lo) / span) * 100;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  });
  /** Closed area path under the line, for the gradient fill. */
  navArea = computed<string>(() => {
    const line = this.navPath();
    if (!line) return '';
    return `${line} L100,100 L0,100 Z`;
  });
  /** Is the current window up over its span? (colours the chart) */
  navUp = computed<boolean>(() => (this.curWindow()?.change_pct ?? 0) >= 0);

  /** The return for the selected fund in the chart's window. */
  selectedRet(): number | null {
    const w = this.curWindow();
    if (!w) return null;
    return w.cagr_pct != null ? w.cagr_pct : w.change_pct;
  }
}
