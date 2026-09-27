import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, OnDestroy, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subscription, catchError, map, of, shareReplay } from 'rxjs';

import { environment } from '../../environments/environment';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact, inr } from '../shared/format.util';
import { ChartSeries, ENTRY_COST_PCT, yearsSince } from './calc.service';
import { FlatInputs, STANDARD_SWP_MONTHLY, STANDARD_VAULT_PCT, VillaFunds, computeFlat } from './flat-calc.model';
import { GrowthChartComponent } from './growth-chart.component';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Selling brokerage. The 1% TDS on a sale is advance tax, credited back — not a cost. */
const SELL_COST_PCT = 2;
/** Earliest month the full villa mix has history for (proxies included). */
const EARLIEST_YEAR = 2007;

const SLEEVES: { key: string; label: string; color: string }[] = [
  { key: 'arbitrage', label: 'Arbitrage · pays you', color: '#8aa89b' },
  { key: 'large', label: 'Large cap', color: '#4a9d47' },
  { key: 'mid', label: 'Mid cap', color: '#5cb85c' },
  { key: 'small', label: 'Small cap', color: '#8fd48a' },
  { key: 'gold', label: 'Gold', color: '#f6c445' },
];

/** Fund paths per start month — shared across opens, one request per month. */
const pathsCache = new Map<string, Observable<VillaFunds | null>>();

/**
 * Flat calculator — what the flat REALLY returned (price, rent, vacancy, tax,
 * upkeep, entry and selling costs → one all-in yearly rate), then the same money
 * in the DigiVilla bucket paying the SAME in-hand rent every month. The flat's
 * rent sets the arbitrage vault: a smaller rent needs a smaller vault, so more
 * of the money compounds in the growth sleeves. Maths in flat-calc.model.ts.
 */
@Component({
  selector: 'app-flat-calc',
  standalone: true,
  imports: [CommonModule, GrowthChartComponent, MfDisclaimerComponent],
  templateUrl: './flat-calc.component.html',
  // shares the land calculator's cards/fields/tiles so the two read as one family
  styleUrls: ['./land-calc.component.scss', './flat-calc.component.scss'],
})
export class FlatCalcComponent implements OnDestroy {
  @Output() back = new EventEmitter<void>();
  private http = inject(HttpClient);
  compact = compact;
  inr = inr;
  readonly MONTHS = MONTHS;
  readonly SLEEVES = SLEEVES;
  readonly STANDARD_VAULT = STANDARD_VAULT_PCT;
  readonly SLABS = [0, 5, 20, 30];

  private readonly now = new Date();
  readonly years: number[] = Array.from({ length: this.now.getFullYear() - EARLIEST_YEAR }, (_, i) => this.now.getFullYear() - 1 - i);

  // ── inputs (a worked example so the result shows immediately; all editable) ──
  readonly price = signal(80_00_000);
  readonly valueNow = signal(1_40_00_000);
  readonly rentNow = signal(30_000);
  readonly buyYear = signal(2015);
  readonly buyMonth = signal(6);
  readonly taxSlab = signal(30);
  readonly entryPct = signal(ENTRY_COST_PCT);
  readonly sellPct = signal(SELL_COST_PCT);
  readonly rentGrowth = signal(5);
  readonly vacancy = signal(1);
  readonly upkeep = signal(3_000);
  readonly moreOpen = signal(false);
  /** null = the rent-matched vault; a number = the user dragged the slider. */
  readonly vaultOverride = signal<number | null>(null);

  readonly startYm = computed(() => `${this.buyYear()}-${String(this.buyMonth()).padStart(2, '0')}`);
  readonly heldYears = computed(() => yearsSince(this.startYm(), this.now));
  readonly valid = computed(() => this.price() > 0 && this.valueNow() > 0 && this.heldYears() >= 1);

  // ── the villa mix's fund paths for the purchase month ──
  readonly funds = signal<VillaFunds | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);
  private sub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;

  readonly inputs = computed<FlatInputs>(() => ({
    start: this.startYm(), price: this.price(), entryPct: this.entryPct(), valueNow: this.valueNow(),
    rentNow: this.rentNow(), rentGrowthPct: this.rentGrowth(), vacancyMonths: this.vacancy(),
    taxSlabPct: this.taxSlab(), upkeepNow: this.upkeep(), exitPct: this.sellPct(),
  }));

  readonly result = computed(() => {
    const f = this.funds();
    return f && this.valid() ? computeFlat(this.inputs(), f, this.vaultOverride()) : null;
  });

  readonly vaultPct = computed(() => this.result()?.matched.vaultPct ?? 0);
  readonly overridden = computed(() => this.vaultOverride() !== null);
  readonly standardSwp = computed(() => (this.result()?.outlay ?? 0) * STANDARD_SWP_MONTHLY);
  readonly gain = computed(() => {
    const r = this.result();
    return r ? r.matched.final - r.flatFinal : 0;
  });
  readonly vaultShift = computed(() => {
    const r = this.result();
    return r ? (r.outlay * (STANDARD_VAULT_PCT - r.matched.vaultPct)) / 100 : 0;
  });
  readonly proxies = computed(() => (this.funds()?.funds ?? []).flatMap((f) => f.proxy.map((p) => ({ fund: f.name, ...p }))));

  /** Stacked allocation bars: standard 36% vault vs the vault this flat's rent needs. */
  readonly bars = computed(() => {
    const mix = (vault: number) => {
      const rest = (100 - vault) / 4;
      return SLEEVES.map((s) => ({ ...s, pct: s.key === 'arbitrage' ? vault : rest }));
    };
    return { standard: mix(STANDARD_VAULT_PCT), yours: mix(this.vaultPct()) };
  });

  readonly chart = computed<ChartSeries[]>(() => {
    const r = this.result();
    if (!r) return [];
    const pts = (vals: number[]) => r.months.map((m, i) => ({ date: m, value: Math.round(vals[i]) }));
    const out: ChartSeries[] = [
      { label: this.overridden() ? `DigiVilla · ${this.fmtPct(r.matched.vaultPct, 0)} vault` : 'DigiVilla · vault sized to your rent',
        color: 'var(--brass, #8B7BF0)', points: pts(r.matched.values), area: true },
    ];
    if (Math.abs(r.matched.vaultPct - STANDARD_VAULT_PCT) >= 0.5) {
      out.push({ label: 'DigiVilla · standard 36% vault', color: 'var(--muted, #8B95A3)', points: pts(r.standard.values), dashed: true });
    }
    out.push({ label: 'Your flat (if sold)', color: 'var(--gold, #E9C15C)', points: pts(r.flatValues), dashed: true });
    return out;
  });

  constructor() {
    // Re-fetch only when the purchase month changes (debounced while picking);
    // every other input recomputes locally and instantly.
    effect(() => {
      const ym = this.startYm();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.load(ym), untracked(this.funds) ? 300 : 0);
    }, { allowSignalWrites: true });
  }

  load(ym = this.startYm()): void {
    this.sub?.unsubscribe();
    this.loading.set(true);
    this.failed.set(false);
    this.sub = this.paths(ym).subscribe((r) => {
      if (ym !== this.startYm()) return;           // a newer month was picked
      if (r) this.funds.set(r);
      this.failed.set(!r);
      this.loading.set(false);
    });
  }

  private paths(ym: string): Observable<VillaFunds | null> {
    const hit = pathsCache.get(ym);
    if (hit) return hit;
    const req = this.http.get<VillaFunds>(`${environment.apiUrl}/calc/villa-funds`, { params: { start: ym } }).pipe(
      map((r) => (r && r.ok ? r : null)),
      catchError(() => { pathsCache.delete(ym); return of(null); }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    pathsCache.set(ym, req);
    return req;
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); clearTimeout(this.timer); }

  // ── input helpers ──
  money(v: number): string { return v ? v.toLocaleString('en-IN') : ''; }
  onMoney(e: Event, target: 'price' | 'valueNow' | 'rentNow' | 'upkeep'): void {
    const el = e.target as HTMLInputElement;
    const n = Number(el.value.replace(/[^\d]/g, '').slice(0, 12)) || 0;
    this[target].set(n);
    el.value = this.money(n);
  }
  onNum(e: Event, target: 'entryPct' | 'sellPct' | 'rentGrowth' | 'vacancy', max: number): void {
    const n = Math.max(0, Math.min(max, Number((e.target as HTMLInputElement).value) || 0));
    this[target].set(n);
  }
  onVault(e: Event): void {
    const r = this.result();
    const n = Number((e.target as HTMLInputElement).value);
    // snap back onto the rent-matched point when released near it
    this.vaultOverride.set(r && Math.abs(n - r.matchedVaultPct) < 1 ? null : n);
  }
  num(e: Event): number { return Number((e.target as HTMLSelectElement).value); }

  fmtPct(v: number | null | undefined, d = 1): string {
    if (v == null || !isFinite(v)) return '—';
    return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
  }
  ym(m: string | null | undefined): string {
    if (!m) return '';
    const [y, mo] = m.split('-').map(Number);
    return `${MONTHS[mo - 1]} ${y}`;
  }
  /** compact() with a proper minus, for figures that can go below zero. */
  signed(v: number): string { return v < 0 ? `−${compact(-v)}` : compact(v); }
  yearsText(y: number): string { return `${y.toFixed(y < 10 ? 1 : 0)} years`; }
}
