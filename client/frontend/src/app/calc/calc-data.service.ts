import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { PORTFOLIOS, PfKey, VillaFunds, villaRate, withPortfolio } from './backtest.model';

/**
 * The benchmark history behind every calculator — five month-end series
 * (arbitrage, Nifty 50, Midcap 150, Smallcap 250, Gold BeES) from Apr 2010,
 * fetched once per session (~30 KB). Every calculator and every year tab slices
 * it locally, so nothing waits after the first load.
 *
 * Also the choice the calculators SHARE: which villa (Conservative / Balanced /
 * Aggressive, ← → on the villa) and whether the monthly SWP is on — pick it in
 * one calculator and the others follow.
 */
@Injectable({ providedIn: 'root' })
export class CalcDataService {
  private http = inject(HttpClient);
  readonly data = signal<VillaFunds | null>(null);
  readonly failed = signal(false);
  private inflight = false;

  /** the villa every calculator shows */
  readonly villa = signal<PfKey>('balanced');
  /** the monthly SWP (3.6% a year of what you put in) */
  readonly swp = signal(true);
  /** the history, weighted for the chosen villa */
  readonly villaData = computed(() => { const d = this.data(); return d ? withPortfolio(d, this.villa()) : null; });
  /** each villa's growth a year over the whole history, nothing withdrawn */
  readonly rates = computed<Record<PfKey, number> | null>(() => {
    const d = this.data();
    if (!d) return null;
    return Object.fromEntries(PORTFOLIOS.map((p) => [p.key, villaRate(d, p.key)])) as Record<PfKey, number>;
  });

  load(): void {
    if (this.data() || this.inflight) return;
    this.inflight = true;
    this.failed.set(false);
    this.http.get<VillaFunds>(`${environment.apiUrl}/calc/villa-funds`).subscribe({
      next: (r) => {
        this.inflight = false;
        if (r?.ok && r.funds?.length && r.funds.some((f) => f.sleeve === 'arbitrage')) this.data.set(r);
        else this.failed.set(true);
      },
      error: () => { this.inflight = false; this.failed.set(true); },
    });
  }
}
