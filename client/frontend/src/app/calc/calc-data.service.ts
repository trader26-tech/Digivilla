import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { VillaFunds } from './backtest.model';

/**
 * Real month-end NAVs of today's DigiVilla mix, whole history (Jul 2007 → now),
 * fetched once per session (~22 KB) — every calculator and every year tab slices
 * it locally, so nothing waits after the first load. The hub calls load() as it
 * opens, so a calculator usually has the data before its first paint.
 */
@Injectable({ providedIn: 'root' })
export class CalcDataService {
  private http = inject(HttpClient);
  readonly data = signal<VillaFunds | null>(null);
  readonly failed = signal(false);
  private inflight = false;

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
