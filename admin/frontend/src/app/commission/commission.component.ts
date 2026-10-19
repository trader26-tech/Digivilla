import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AdminService, CommissionFund, CommissionOverview, VillaBucket } from '../admin.service';
import { fundKey } from '../home/commission-whatif';

const DEFAULT_VILLA_COST = 500000;

interface Row extends CommissionFund {
  draft: string;        // what's typed in the rate box
  rate: number | null;  // the rate used for the figures (typed, else saved)
  bad: boolean;         // typed something that isn't a valid rate
  changed: boolean;
}

/**
 * Commission — the admin types each fund's trail rate (% a year); the page works
 * out what the money clients hold in that fund earns, per year and per month.
 * Figures update as you type; "Save rates" stores them (merged on the server).
 */
@Component({
  selector: 'app-commission',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './commission.component.html',
  styleUrl: './commission.component.scss',
})
export class CommissionComponent implements OnInit {
  private api = inject(AdminService);

  readonly data = signal<CommissionOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly savedAt = signal<number>(0);
  /** fund key → what's typed (only funds the admin has touched) */
  readonly drafts = signal<Record<string, string>>({});

  /** every villa bucket — one villa of each is costed below */
  readonly buckets = signal<VillaBucket[]>([]);
  readonly bucketsLoading = signal(false);
  /** what one villa is: the settings' villa_cost (₹5 L) invested in a bucket */
  readonly villaCost = signal(DEFAULT_VILLA_COST);
  /** buckets whose fund list is folded away (all open by default) */
  readonly closed = signal<Set<string>>(new Set());
  /** the (i) popovers */
  readonly help = signal<'villa' | 'funds' | null>(null);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.commission().subscribe({
      next: (d) => { this.data.set(d); this.drafts.set({}); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.detail || 'Could not load commission data.'); this.loading.set(false); },
    });
    this.bucketsLoading.set(true);
    this.api.reportBuckets().subscribe({
      next: (b) => { this.buckets.set(b || []); this.bucketsLoading.set(false); },
      error: () => this.bucketsLoading.set(false),
    });
    this.api.calcConfig().subscribe({
      next: (c) => { const cost = c?.config?.estate?.villa_cost; if (cost > 0) this.villaCost.set(cost); },
      error: () => {},
    });
  }

  // ── per villa: one villa (₹5 L) in each bucket, split by the bucket's weights, at the rates in the table (live as you type) ──
  readonly villaRows = computed(() => {
    const cost = this.villaCost();
    const rate: Record<string, number | null> = {};
    for (const r of this.rows()) rate[r.key] = r.rate;
    return this.buckets().map((b) => {
      const tot = b.funds.reduce((s, f) => s + (f.target_weight || 0), 0) || 1;
      const funds = b.funds.map((f) => {
        const key = fundKey(f.scheme_code, f.scheme_name);
        const r = key in rate ? rate[key] : null;
        const share = (f.target_weight || 0) / tot;
        const amount = cost * share;
        return { key, name: f.scheme_name, share, amount, rate: r, yearly: r === null ? 0 : (amount * r) / 100 };
      });
      const yearly = funds.reduce((a, f) => a + f.yearly, 0);
      return {
        id: b.id, name: b.name, tier: b.tier || '', kind: (b.kind || 'sip').toLowerCase(), subtitle: b.subtitle || '',
        funds, yearly, monthly: yearly / 12, rate: cost > 0 ? (yearly / cost) * 100 : 0,
        missing: funds.filter((f) => f.rate === null).length,
      };
    });
  });
  typeKey(tier: string): string {
    const t = tier.trim().toLowerCase();
    return ['conservative', 'balanced', 'aggressive'].includes(t) ? t : 'none';
  }
  isClosed(id: string): boolean { return this.closed().has(id); }
  toggleVilla(id: string): void {
    this.closed.update((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  pctShare(v: number): string { return Math.round(v * 1000) / 10 + '%'; }
  trackVilla = (_: number, v: { id: string }) => v.id;
  trackFund = (_: number, f: { key: string }) => f.key;

  readonly max = computed(() => this.data()?.max_rate_pct ?? 5);

  readonly rows = computed<Row[]>(() => {
    const d = this.data();
    if (!d) return [];
    const drafts = this.drafts(), max = this.max();
    return d.funds.map((f) => {
      const typed = drafts[f.key];
      const touched = typed !== undefined;
      const parsed = touched && typed.trim() !== '' ? Number(typed) : null;
      const bad = touched && typed.trim() !== '' && (!isFinite(parsed!) || parsed! < 0 || parsed! > max);
      const rate = touched ? (bad ? f.rate_pct : parsed) : f.rate_pct;
      const yearly = rate !== null ? (f.aum * rate) / 100 : 0;
      return {
        ...f, rate, bad, yearly, monthly: yearly / 12,
        draft: touched ? typed : f.rate_pct !== null ? String(f.rate_pct) : '',
        changed: touched && !bad && rate !== f.rate_pct,
      };
    });
  });

  readonly totals = computed(() => {
    const rs = this.rows();
    const aum = rs.reduce((s, r) => s + r.aum, 0);
    const rated = rs.filter((r) => r.rate !== null);
    const aumRated = rated.reduce((s, r) => s + r.aum, 0);
    const yearly = rs.reduce((s, r) => s + r.yearly, 0);
    return {
      aum, yearly, monthly: yearly / 12,
      avg: aumRated > 0 ? (yearly / aumRated) * 100 : null,
      missing: rs.filter((r) => r.rate === null && r.aum > 0),
      maxYearly: Math.max(1, ...rs.map((r) => r.yearly)),
    };
  });

  readonly changedCount = computed(() => this.rows().filter((r) => r.changed).length);
  readonly hasBad = computed(() => this.rows().some((r) => r.bad));

  type(key: string, e: Event): void {
    const v = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, '');
    this.drafts.update((d) => ({ ...d, [key]: v }));
  }

  discard(): void { this.drafts.set({}); }

  save(): void {
    if (this.hasBad() || !this.changedCount() || this.saving()) return;
    const patch: Record<string, number | null> = {};
    for (const r of this.rows()) if (r.changed) patch[r.key] = r.rate;
    this.saving.set(true);
    this.api.saveCommissionRates(patch).subscribe({
      next: (d) => {
        this.data.set(d); this.drafts.set({}); this.saving.set(false);
        this.savedAt.set(Date.now());
        setTimeout(() => { if (Date.now() - this.savedAt() >= 2400) this.savedAt.set(0); }, 2500);
      },
      error: (e) => { this.saving.set(false); this.error.set(e?.error?.detail || 'Could not save the rates.'); },
    });
  }

  // ── formatting ──
  inr(v: number): string { return '₹' + Math.round(v).toLocaleString('en-IN'); }
  compact(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return this.inr(v);
  }
  pct(v: number | null, dp = 2): string { return v === null ? '—' : v.toFixed(dp) + '%'; }
  /** a trail rate exactly as typed in the table: 0.329% stays 0.329%, 0.5% stays 0.5% */
  rateFmt(v: number): string { return String(Math.round(v * 10000) / 10000) + '%'; }
  when(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  trackKey = (_: number, r: Row) => r.key;
}
