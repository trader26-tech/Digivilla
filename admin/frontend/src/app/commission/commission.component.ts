import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AdminService, CommissionFund, CommissionOverview } from '../admin.service';

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

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.commission().subscribe({
      next: (d) => { this.data.set(d); this.drafts.set({}); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.detail || 'Could not load commission data.'); this.loading.set(false); },
    });
  }

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
  when(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  trackKey = (_: number, r: Row) => r.key;
}
