import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';

import { AdminService, MappingOverview, UnmappedClient } from '../admin.service';

/**
 * Home: every transaction that is not yet mapped to a villa, in full — one
 * table, grouped by client, nothing collapsed. The client app can't place this
 * money until it is mapped, so this is the admin's main to-do.
 */
@Component({
  selector: 'app-unmapped-txns',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './unmapped-txns.component.html',
  styleUrl: './unmapped-txns.component.scss',
})
export class UnmappedTxnsComponent {
  @Input() set overview(v: MappingOverview | null) { this.data.set(v); }
  /** "Map now" → open that client's drawer on the Villas tab */
  @Output() map = new EventEmitter<string>();
  /** after a holdings rebuild → the home re-pulls its figures */
  @Output() rebuilt = new EventEmitter<void>();

  private api = inject(AdminService);
  readonly data = signal<MappingOverview | null>(null);
  readonly rebuilding = signal(false);
  readonly rebuildMsg = signal('');
  /** the (i) popover: which section is explaining itself */
  readonly help = signal<'tie' | 'um' | null>(null);

  /** Repair: holdings := the roll-up of every transaction (idempotent). */
  rebuild(): void {
    if (this.rebuilding()) return;
    this.rebuilding.set(true); this.rebuildMsg.set('');
    this.api.rebuildHoldings().subscribe({
      next: (r) => {
        this.rebuilding.set(false);
        this.rebuildMsg.set(r.consistency.ok ? `Rebuilt ${r.rows} holdings for ${r.clients} clients — everything ties out.` : `Rebuilt, but ${r.consistency.off.length} client(s) still differ.`);
        this.data.update((d) => d ? { ...d, consistency: { ok: r.consistency.ok, off: r.consistency.off } } : d);
        this.rebuilt.emit();
      },
      error: () => { this.rebuilding.set(false); this.rebuildMsg.set('Couldn’t rebuild — try again.'); },
    });
  }

  /** biggest unmapped amount first */
  readonly clients = computed<UnmappedClient[]>(() =>
    [...(this.data()?.clients || [])].sort((a, b) => b.unmapped_amount - a.unmapped_amount));

  readonly mappedPct = computed(() => {
    const d = this.data();
    return d?.total ? Math.round((d.mapped / d.total) * 100) : 0;
  });

  money(v: number): string {
    return '₹' + Math.round(v || 0).toLocaleString('en-IN');
  }

  day(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  initials(name: string): string {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  }

  /** "Jayabharathi Santhanam" from the report's ALL CAPS */
  title(name: string): string {
    return (name || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }

}
