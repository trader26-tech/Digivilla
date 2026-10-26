import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';

import { AdminService, PlacementPending, PlacementSet, VillaType } from '../admin.service';

/** Placement — the purchases the system could not place by itself, each one a
 *  single tap: use the closest recipe, start a new recipe of a category from the
 *  purchase's own mix, or keep it out of the villas. Everything that matched a
 *  recipe was already placed on upload. */
@Component({
  selector: 'app-placements',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './placements.component.html',
  styleUrl: './placements.component.scss',
})
export class PlacementsComponent implements OnInit {
  private api = inject(AdminService);
  private el = inject(ElementRef<HTMLElement>);
  /** pending count · amount, for the home KPI */
  @Output() counts = new EventEmitter<{ count: number; amount: number }>();
  /** a decision was made → villas and figures changed */
  @Output() changed = new EventEmitter<void>();

  readonly data = signal<PlacementPending | null>(null);
  readonly busyKey = signal<string | null>(null);
  readonly pickFor = signal<string | null>(null);        // set key with the "other recipe" list open
  readonly error = signal('');
  readonly justPlaced = signal<string>('');              // a one-line confirmation
  readonly autoCount = signal(0);                        // placed by the matcher on this load
  /** what the engine placed by itself on this load — shown with an Undo */
  readonly auto = signal<PlacementSet[]>([]);
  readonly flash = signal(false);
  /** the list is folded by default — the head line says how much is waiting */
  readonly open = signal(false);
  readonly autoOpen = signal(true);
  private flashT?: ReturnType<typeof setTimeout>;

  readonly SLEEVE_COLOUR: Record<string, string> = { arbitrage: '#98a0b8', gold: '#eda100', large: '#387ed1', mid: '#eb6834', small: '#1baf7a', other: '#6250d6' };
  readonly CATS: { key: VillaType; name: string }[] = [
    { key: 'conservative', name: 'Conservative' }, { key: 'balanced', name: 'Balanced' }, { key: 'aggressive', name: 'Aggressive' },
  ];

  ngOnInit(): void { this.load(); }
  load(): void {
    this.api.placementRun().subscribe({
      next: (d) => { this.data.set(d); this.autoCount.set(d.auto_count || 0); this.auto.set(d.recent?.length ? d.recent : (d.auto ?? [])); this.error.set(''); this.counts.emit({ count: d.count, amount: d.amount }); if (d.auto_count) this.changed.emit(); },
      error: () => this.error.set('Could not load.'),
    });
  }
  /** after an upload: reload, pulse and scroll into view when there is work */
  refresh(): void {
    this.api.placementRun().subscribe({
      next: (d) => {
        this.data.set(d); this.autoCount.set(d.auto_count || 0); this.auto.set(d.recent?.length ? d.recent : (d.auto ?? [])); this.counts.emit({ count: d.count, amount: d.amount });
        if (d.auto_count) this.changed.emit();
        if (d.count || d.auto_count) {
          this.flash.set(true); clearTimeout(this.flashT); this.flashT = setTimeout(() => this.flash.set(false), 2400);
          this.el.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
    });
  }

  readonly sets = computed(() => this.data()?.pending ?? []);
  readonly buckets = computed(() => this.data()?.buckets ?? []);

  decide(s: PlacementSet, action: 'category' | 'bucket' | 'outside', extra: { category?: VillaType; bucket_id?: string } = {}): void {
    if (this.busyKey()) return;
    this.busyKey.set(s.key); this.pickFor.set(null); this.error.set('');
    this.api.placementDecide({ order_ids: s.order_ids, action, ...extra }).subscribe({
      next: (r) => {
        this.busyKey.set(null);
        const what = action === 'outside' ? 'kept outside the villas'
          : action === 'bucket' ? `placed · ${this.buckets().find((b) => b.id === extra.bucket_id)?.name ?? 'recipe'}`
          : `placed · new ${this.CATS.find((c) => c.key === extra.category)?.name} recipe${r.bucket ? ' “' + r.bucket.name + '”' : ''}`;
        this.justPlaced.set(`${this.title(s.client_name)} · ${this.money(s.total)} ${what}`);
        setTimeout(() => this.justPlaced.set(''), 5000);
        this.load(); this.changed.emit();
      },
      error: (e) => { this.busyKey.set(null); this.error.set(e?.error?.detail || 'Could not place it — try again.'); },
    });
  }

  /** take an automatic placement back: the set returns to the decisions */
  undo(s: PlacementSet): void {
    if (this.busyKey()) return;
    this.busyKey.set(s.key);
    this.api.placementUndo(s.order_ids).subscribe({
      next: () => { this.busyKey.set(null); this.auto.set(this.auto().filter((x) => x.key !== s.key)); this.load(); this.changed.emit(); },
      error: (e) => { this.busyKey.set(null); this.error.set(e?.error?.detail || 'Could not undo — try again.'); },
    });
  }
  dismissAuto(): void { this.auto.set([]); }
  /** "1 villa · ₹25 short of ₹5 L (stamp duty)" / "2 villas" / "" */
  villasNote(s: PlacementSet): string {
    if (!s.villas) return '';
    const n = `${s.villas} villa${s.villas === 1 ? '' : 's'}`;
    return s.short && s.short > 0 ? `${n} · ₹${Math.round(s.short).toLocaleString('en-IN')} short of ${this.money(s.villas * (s.unit || 0))} — stamp duty, counts as full` : n;
  }
  tierName(t?: VillaType | null): string { return this.CATS.find((c) => c.key === t)?.name ?? ''; }
  /** the primary action: the closest recipe when it is close enough */
  best(s: PlacementSet) { const g = s.suggested; return g && g.similarity >= 0.5 ? g : null; }
  pct(v: number): string { return Math.round(v * 100) + '%'; }
  simPct(v: number): string { return Math.round(v * 100) + '%'; }
  colour(name: string, sleeve?: string | null): string {
    const n = (name || '').toLowerCase();
    const s = sleeve || (n.includes('arbitrage') ? 'arbitrage' : n.includes('gold') ? 'gold' : n.includes('small') ? 'small' : n.includes('mid') ? 'mid' : n.includes('large') || n.includes('bluechip') || n.includes('nifty 50') ? 'large' : 'other');
    return this.SLEEVE_COLOUR[s] ?? this.SLEEVE_COLOUR['other'];
  }
  short(name: string): string {
    return (name || '').replace(/\s*-\s*(Growth|Direct|Regular|IDCW).*$/i, '').replace(/\bFund\b/i, '').replace(/\s+/g, ' ').trim();
  }
  money(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  title(s: string): string { return (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
  day(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  kind(k: string): string { return k.includes('lump') ? 'Lumpsum' : k.includes('sip') ? 'SIP' : (k || '').replace(/\b\w/g, (c) => c.toUpperCase()); }
  trackKey = (_: number, s: PlacementSet) => s.key;
}
