import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';

import { EstateService, FundMove, FundMoves } from '../estate.service';
import { inr } from '../shared/format.util';

/** Sleeve → colour (the same palette as the home allocation bar). */
const SLEEVE_COLOR: Record<string, string> = {
  arbitrage: '#8aa89b', debt: '#7fa9c9', hybrid: '#a99be6', gold: '#f6c445', large: '#4a9d47',
  multi: '#3f9a86', mid: '#5cb85c', small: '#8fd48a', other: '#9fb3ab',
};
const SLEEVE_NAME: Record<string, string> = {
  arbitrage: 'Arbitrage', debt: 'Debt', hybrid: 'Hybrid', gold: 'Gold', large: 'Large cap',
  multi: 'Multi cap', mid: 'Mid cap', small: 'Small cap', other: 'Other',
};

/** One fund's day, next to its index's day. */
interface Row {
  key: number; name: string; sleeve: string; color: string;
  change: number | null;            // ₹ moved today (units × ΔNAV)
  pct: number | null;               // the fund's NAV move, %
  bench: string | null;             // the index it is measured against
  benchPct: number | null;          // the index's move the same day, %
  gap: number | null;               // fund − index, percentage points
  wF: number; wB: number;           // bar widths on one shared scale (% of the track)
  late: string | null;              // the fund's NAV is an older day than the rest
}

/**
 * "Today" — opened by tapping the portfolio value (or the growth line under it).
 * One question, answered plainly: how did my money move today, and how did each
 * fund do against the index it follows?
 *   1. the day's ₹ and % for the whole estate
 *   2. your funds vs their indices (value-weighted), with a one-line verdict
 *   3. each fund: its move and its index's move as two bars on one scale, and
 *      "beat by / behind by" in plain words
 * Data: GET /me/funds/moves (loaded once, cached by EstateService).
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

  private readonly _open = signal(false);
  @Input() set open(v: boolean) { this._open.set(!!v); if (v) this.est.loadMoves(); }
  get open(): boolean { return this._open(); }
  @Output() closed = new EventEmitter<void>();
  readonly isOpen = computed(() => this._open());

  readonly m = computed<FundMoves | null>(() => this.est.moves());
  readonly change = computed(() => this.m()?.total.change ?? null);
  readonly pct = computed(() => this.m()?.total.pct ?? null);
  readonly down = computed(() => (this.change() ?? 0) < 0);

  close(): void { this._open.set(false); this.closed.emit(); }
  @HostListener('document:keydown.escape') onEsc(): void { if (this._open()) this.close(); }

  /** every fund, biggest ₹ move first, with its index beside it */
  readonly rows = computed<Row[]>(() => {
    const m = this.m(); if (!m) return [];
    const fs = m.funds.filter((f) => f.day_change != null || f.day_pct != null);
    const scale = Math.max(0.1, ...fs.map((f) => Math.abs(f.day_pct ?? 0)), ...fs.map((f) => Math.abs(f.bench?.day_pct ?? 0)));
    return fs.map((f: FundMove) => {
      const b = f.bench?.day_pct ?? null;
      return {
        key: f.scheme_code, name: f.short, sleeve: SLEEVE_NAME[f.sleeve] ?? 'Other', color: SLEEVE_COLOR[f.sleeve] ?? SLEEVE_COLOR['other'],
        change: f.day_change, pct: f.day_pct, bench: f.bench?.name ?? null, benchPct: b,
        gap: f.day_pct != null && b != null ? f.day_pct - b : null,
        wF: Math.abs(f.day_pct ?? 0) / scale * 100, wB: Math.abs(b ?? 0) / scale * 100,
        late: m.nav_date && f.nav_date && f.nav_date < m.nav_date ? this.dayShort(f.nav_date) : null,
      };
    }).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  });

  /** your funds vs their indices, each weighted by what you hold in it */
  readonly vs = computed(() => {
    const m = this.m(); if (!m) return null;
    let w = 0, idx = 0;
    for (const f of m.funds) {
      const b = f.bench?.day_pct;
      if (b == null || !f.value) continue;
      w += f.value; idx += f.value * b;
    }
    const mine = this.pct();
    if (!w || mine == null) return null;
    const theirs = idx / w, gap = mine - theirs;
    const scale = Math.max(0.1, Math.abs(mine), Math.abs(theirs));
    return { mine, theirs, gap, wM: Math.abs(mine) / scale * 100, wT: Math.abs(theirs) / scale * 100 };
  });
  /** how many funds beat their index today */
  readonly score = computed(() => {
    const r = this.rows().filter((x) => x.gap != null);
    return { beat: r.filter((x) => (x.gap ?? 0) >= 0).length, of: r.length };
  });

  // ── words ──
  signedInr(v: number | null | undefined): string { return v == null ? '—' : (v < 0 ? '−' : '+') + inr(Math.abs(v)); }
  signedPct(v: number | null | undefined, dp = 2): string {
    if (v == null || !isFinite(v)) return '—';
    return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dp) + '%';
  }
  pts(v: number): string { return Math.abs(v).toFixed(2) + ' pts'; }
  dayShort(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  /** "Today" / "Yesterday" / "Fri 16 Oct" — NAV dates are Indian dates */
  dayWhen(iso: string | null | undefined): string {
    if (!iso) return 'Today';
    const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
    if (iso === ist(Date.now())) return 'Today';
    if (iso === ist(Date.now() - 86_400_000)) return 'Yesterday';
    return this.dayShort(iso);
  }
  sign(v: number | null | undefined): 'up' | 'dn' | '' { return v == null ? '' : v > 0.0001 ? 'up' : v < -0.0001 ? 'dn' : ''; }
  trackRow(_: number, r: Row): number { return r.key; }
}
