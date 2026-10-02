import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { CalcConfig, DEFAULT_CONFIG, VillaFunds, villaOf, villaRate, withVilla } from './engine';

const CFG_KEY = 'dv_calc_config';

/**
 * The calculators' STORE — one place that holds:
 *   • config   the SETTINGS (villas, rebalancing, SWP, tax, estate, flat…) from
 *              GET /calc/config. Starts from the copy last seen on this device
 *              (else the built-in default), then refreshes — so a change made in
 *              the admin reaches the app on its next open.
 *   • data     the benchmark history (GET /calc/villa-funds), fetched once.
 *   • choices  the villa and SWP the user picked — shared by every calculator.
 * Everything a screen shows is derived from these (see calc/view/*.view.ts).
 */
@Injectable({ providedIn: 'root' })
export class CalcDataService {
  private http = inject(HttpClient);

  // ── settings ──
  readonly config = signal<CalcConfig>(readCached() ?? DEFAULT_CONFIG);
  private cfgLoaded = false;

  // ── data ──
  readonly data = signal<VillaFunds | null>(null);
  readonly failed = signal(false);
  private inflight = false;

  // ── the user's choices (null = the settings' default) ──
  private readonly villaKey = signal<string | null>(null);
  private readonly swpPick = signal<boolean | null>(null);
  readonly villa = computed(() => villaOf(this.config(), this.villaKey()));
  readonly swp = computed(() => this.swpPick() ?? this.config().withdrawals.swp_default);
  pickVilla(key: string): void { this.villaKey.set(key); }
  setSwp(on: boolean): void { this.swpPick.set(on); }

  /** the history, weighted for the chosen villa */
  readonly villaData = computed(() => { const d = this.data(); return d ? withVilla(d, this.villa()) : null; });
  /** each villa's growth a year over the whole history, nothing withdrawn */
  readonly rates = computed<Record<string, number> | null>(() => {
    const d = this.data(), cfg = this.config();
    return d ? Object.fromEntries(cfg.villas.map((v) => [v.key, villaRate(d, cfg, v.key)])) : null;
  });

  /** The yearly return the open calculator shows for the chosen villa, and over how many years.
   *  The villa picker shows this instead of the long-run rate, so a screen never shows two
   *  different "% a yr" for the same villa. null = no calculator open. */
  readonly shown = signal<{ rate: number | null; years: number } | null>(null);

  /** Settings + data (both cached after the first call). */
  load(): void {
    this.loadConfig();
    if (this.data() || this.inflight) return;
    this.inflight = true;
    this.failed.set(false);
    this.http.get<VillaFunds>(`${environment.apiUrl}/calc/villa-funds`).subscribe({
      next: (r) => {
        this.inflight = false;
        if (r?.ok && r.funds?.length) this.data.set(r);
        else this.failed.set(true);
      },
      error: () => { this.inflight = false; this.failed.set(true); },
    });
  }

  /** Just the settings (Home needs the estate numbers, not the history). */
  loadConfig(): void {
    if (this.cfgLoaded) return;
    this.cfgLoaded = true;
    this.http.get<CalcConfig>(`${environment.apiUrl}/calc/config`).subscribe({
      next: (c) => {
        if (!c?.villas?.length) return;
        if (c.version !== this.config().version || c.updated_at !== this.config().updated_at) this.config.set(c);
        try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch { /* private mode */ }
      },
      error: () => { this.cfgLoaded = false; },
    });
  }
}

function readCached(): CalcConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    return c?.villas?.length && c.tax && c.estate && c.withdrawals && c.flat ? c : null;
  } catch { return null; }
}
