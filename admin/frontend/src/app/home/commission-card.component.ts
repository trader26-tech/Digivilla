import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnInit, Output, computed, inject, signal } from '@angular/core';

import { AdminService, CommissionLedger, CommissionOverview, VillaBucket, VillaSummary } from '../admin.service';
import { VillaComm, villaComm } from './commission-villas';

const LS_KEY = 'dv_admin_comm_sell';
const DEFAULT_VILLA_COST = 500000;

/** Home card: commission in VILLAS, not funds.
 *   • today — what the villas clients hold earn now;
 *   • each villa — what ONE more Conservative / Balanced / Aggressive villa earns;
 *   • if you sell — pick how many of each; it adds them up, a month and a year.
 *  A villa = the settings' villa_cost on that type's villa bucket, at the saved trail
 *  rates (set on the Commission tab). GET /admin/commission is slow — loaded once. */
@Component({
  selector: 'app-commission-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './commission-card.component.html',
  styleUrls: ['./home-cards.scss', './commission-card.component.scss'],
})
export class CommissionCardComponent implements OnInit {
  private api = inject(AdminService);
  @Output() open = new EventEmitter<void>();

  readonly data = signal<CommissionOverview | null>(null);
  readonly error = signal(false);
  readonly buckets = signal<VillaBucket[]>([]);
  readonly villas = signal<{ key: string; name: string }[]>([]);
  readonly villaCost = signal(DEFAULT_VILLA_COST);
  readonly sold = signal<VillaSummary | null>(null);
  readonly ledger = signal<CommissionLedger | null>(null);

  /** how many of each type the admin plans to sell */
  readonly sell = signal<Record<string, number>>({});
  payDay(iso: string): string { const d = new Date(iso + 'T12:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  readonly picks = [1, 10, 100];
  /** the "if you sell more villas" popup */
  readonly whatIf = signal(false);
  @HostListener('document:keydown.escape') esc(): void { this.whatIf.set(false); }

  ngOnInit(): void {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s && typeof s === 'object') this.sell.set(s);
    } catch { /* defaults */ }
    this.load();
    this.api.reportBuckets().subscribe({ next: (b) => this.buckets.set(b || []), error: () => {} });
    this.api.calcConfig().subscribe({
      next: (c) => {
        this.villas.set(c?.config?.villas || []);
        const cost = c?.config?.estate?.villa_cost;
        if (cost > 0) this.villaCost.set(cost);
      },
      error: () => {},
    });
    this.api.villasSummary().subscribe({ next: (s) => this.sold.set(s), error: () => {} });
    this.api.commissionLedger().subscribe({ next: (l) => this.ledger.set(l), error: () => {} });
  }
  load(): void {
    this.error.set(false);
    this.api.commission().subscribe({ next: (d) => this.data.set(d), error: () => this.error.set(true) });
  }

  /** one villa of each type */
  /** one row per RECIPE (villa bucket): what a ₹5 L villa of it earns, how many are held */
  readonly rows = computed<VillaComm[]>(() => {
    const d = this.data(); const sold = this.sold();
    if (!d) return [];
    if (sold?.buckets?.length) {
      return sold.buckets.map((b) => ({ key: b.bucket_id, name: b.name, perYear: b.per_villa_year, rate: b.rate_pct,
        missing: b.rates_missing || [], held: b.count, heldYear: b.commission }));
    }
    return villaComm(this.villaCost(), d, this.buckets(), this.villas(), sold?.types ?? []);
  });
  /** fund names with no rate, across the villa buckets */
  readonly missing = computed(() => [...new Set(this.rows().flatMap((r) => r.missing))]);

  // ── the "if you sell" plan ──
  count(k: string): number { return this.sell()[k] || 0; }
  setCount(k: string, n: number): void {
    const v = Math.max(0, Math.min(100000, Math.round(n || 0)));
    this.sell.set({ ...this.sell(), [k]: v });
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.sell())); } catch { /* ignore */ }
  }
  step(k: string, d: number): void { this.setCount(k, this.count(k) + d); }
  typeCount(k: string, e: Event): void { this.setCount(k, Number((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))); }
  /** a quick pick: that many of each type */
  each(n: number): void { for (const r of this.rows()) this.setCount(r.key, n); }
  clear(): void { this.sell.set({}); try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }

  readonly plan = computed(() => {
    let villas = 0, yearly = 0;
    for (const r of this.rows()) { const n = this.count(r.key); villas += n; yearly += n * r.perYear; }
    return { villas, yearly, money: villas * this.villaCost() };
  });
  /** today's commission (the Commission page's total) */
  readonly nowYear = computed(() => this.data()?.totals.yearly ?? 0);
  readonly heldVillas = computed(() => this.sold()?.totals.count ?? null);
  readonly best = computed(() => Math.max(1, ...this.rows().map((r) => r.perYear)));

  inr(v: number): string { return '₹' + Math.round(v).toLocaleString('en-IN'); }
  compact(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return this.inr(v);
  }
  plural(n: number, w: string): string { return `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`; }
}
