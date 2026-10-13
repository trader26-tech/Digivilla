import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, of, switchMap } from 'rxjs';

import { AdminService, ClientTxn, ClientVilla, MappingOverview, NetWorthRow, VillaBucket, VillaType } from '../admin.service';
import { BucketInfo, Purchase, TYPES, VILLA_FULL, bucketInfo, purchases, villaLabel, villaMixType } from './villa-mapper.logic';

/**
 * Map clients → villas, on the home "Villas sold" panel.
 * Left: clients (those with purchases to map first). Right: the chosen client's
 * villas — each with its type — and the purchases still to place. A purchase
 * (all its fund lines, one day, one kind) is pinned as a whole: drag it onto a
 * villa, tap its suggestion, or pick from its menu. "New villa" cards take a type.
 */
@Component({
  selector: 'app-villa-mapper',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './villa-mapper.component.html',
  styleUrl: './villa-mapper.component.scss',
})
export class VillaMapperComponent implements OnInit {
  private api = inject(AdminService);
  /** any pin / type change — the panel reloads its tiles */
  @Output() changed = new EventEmitter<void>();
  /** open a client's full drawer */
  @Output() openClient = new EventEmitter<string>();

  readonly TYPES = TYPES;
  readonly clients = signal<NetWorthRow[]>([]);
  readonly overview = signal<MappingOverview | null>(null);
  readonly info = signal<BucketInfo>({ sleeveOf: new Map(), arbOf: {} });
  readonly q = signal('');
  readonly filter = signal<'todo' | 'all'>('todo');

  readonly code = signal<string>('');
  readonly villas = signal<ClientVilla[]>([]);
  readonly txns = signal<ClientTxn[]>([]);
  readonly loading = signal(false);
  readonly busy = signal<string | null>(null);      // purchase key / villa id being saved
  readonly menu = signal<string | null>(null);      // purchase key whose "move to" menu is open
  readonly dragKey = signal<string | null>(null);
  readonly dropOn = signal<string | null>(null);
  readonly showOther = signal(false);
  /** the outside-the-villas list opens by itself when it is all there is to map */
  readonly otherOpen = computed(() => this.showOther() || (!this.todo().length && this.other().length > 0));
  readonly toast = signal('');
  private toastT: any;

  /** The home's mapping overview — ONE copy for the whole home (the unmapped list,
   *  the KPI strip and this mapper), so the counts can never disagree. When it is
   *  given, this mapper never fetches its own; a pin here emits `changed` and the
   *  home reloads it. When it changes (e.g. a pin made in the client drawer), the
   *  open client is reloaded too. */
  @Input() set overviewIn(o: MappingOverview | null | undefined) {
    if (o === undefined) return;
    this.external = true;
    if (!o) return;
    const had = !!this.overview();
    this.overview.set(o);
    if (had && this.code()) this.reload();
    else this.pickFirst();
  }
  private external = false;

  ngOnInit(): void {
    this.api.reportBuckets().subscribe({ next: (b: VillaBucket[]) => this.info.set(bucketInfo(b || [])), error: () => {} });
    if (!this.external) this.loadOverview(true);
    this.api.reportClients().subscribe({ next: (c) => { this.clients.set((c || []).filter((x) => !x.demo)); this.pickFirst(); }, error: () => {} });
  }

  private loadOverview(first = false): void {
    if (this.external) return;                     // the home owns it: it reloads after `changed`
    this.api.mappingOverview().subscribe({
      next: (o) => { this.overview.set(o); if (first) this.pickFirst(); },
      error: () => {},
    });
  }
  /** start on the first client with something to map */
  private pickFirst(): void {
    if (this.code() || !this.clients().length || !this.overview()) return;
    const c = this.list()[0];
    if (c) this.select(c.client_code);
  }

  // ── clients ──
  todoOf(code: string): number { return this.overview()?.by_client?.[code]?.unmapped ?? 0; }
  readonly todoTotal = computed(() => this.overview()?.unmapped ?? 0);
  readonly list = computed(() => {
    const q = this.q().trim().toLowerCase();
    let cs = this.clients().filter((c) => !q || c.name.toLowerCase().includes(q) || c.client_code.includes(q));
    if (this.filter() === 'todo' && !q) {
      const todo = cs.filter((c) => this.todoOf(c.client_code) > 0);
      if (todo.length) cs = todo;
    }
    return [...cs].sort((a, b) => (this.todoOf(b.client_code) > 0 ? 1 : 0) - (this.todoOf(a.client_code) > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  });
  readonly client = computed(() => this.clients().find((c) => c.client_code === this.code()) ?? null);

  select(code: string): void {
    if (code === this.code()) return;
    this.code.set(code);
    this.villas.set([]);
    this.txns.set([]);
    this.menu.set(null);
    this.showOther.set(false);
    this.reload();
  }
  private reload(after?: () => void): void {
    const code = this.code();
    if (!code) return;
    this.loading.set(true);
    forkJoin({ v: this.api.clientVillas(code), t: this.api.clientTransactions(code) }).subscribe({
      next: ({ v, t }) => {
        if (code !== this.code()) return;
        this.villas.set([...v].sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || (a.sort_order ?? 0) - (b.sort_order ?? 0)));
        this.txns.set(t);
        this.loading.set(false);
        after?.();
      },
      error: () => { this.loading.set(false); this.flash('Couldn’t load this client'); },
    });
  }

  // ── purchases ──
  readonly all = computed<Purchase[]>(() => {
    const ids = new Set(this.villas().map((v) => v.id));
    // a pin to a villa that no longer exists counts as unpinned
    const ts = this.txns().map((t) => (t.villa_id && !ids.has(t.villa_id) ? { ...t, villa_id: null } : t));
    return purchases(ts, this.villas(), this.info());
  });
  readonly todo = computed(() => this.all().filter((p) => !p.villaId && p.villaFunds));
  readonly other = computed(() => this.all().filter((p) => !p.villaId && !p.villaFunds));
  readonly todoAmount = computed(() => this.todo().reduce((s, p) => s + p.total, 0));
  /** everything still to place: villa-fund purchases first, then funds outside the villas */
  readonly places = computed(() => [...this.todo(), ...this.other()]);
  readonly placeAmount = computed(() => this.places().reduce((s, p) => s + p.total, 0));
  pinnedTo(v: ClientVilla): Purchase[] { return this.all().filter((p) => p.villaId === v.id); }
  mixType(v: ClientVilla): VillaType | null { return villaMixType(v, this.all(), this.info()); }

  suggestLabel(p: Purchase): string {
    if (p.suggest !== 'new') {
      const v = this.villas().find((x) => x.id === p.suggest);
      return v ? villaLabel(v) : 'new villa';
    }
    return 'New ' + (p.type ? this.typeLabel(p.type) + ' ' : '') + 'villa';
  }
  /** pin a whole purchase: to a villa id, or 'new' / 'new:<type>' */
  pin(p: Purchase, target: string, done?: () => void): void {
    if (this.busy() && !done) return;
    this.menu.set(null);
    this.busy.set(p.key);
    const ids = p.txns.map((t) => t.order_id);
    const fail = (e: any) => { this.busy.set(null); this.flash(e?.status === 401 ? 'Session expired — unlock again' : 'Couldn’t pin that — try again'); };
    const ok = (label: string) => {
      this.after(() => { this.busy.set(null); if (done) done(); else this.flash(`Pinned to ${label}`); });
    };
    if (target.startsWith('new')) {
      const type = (target.split(':')[1] as VillaType) || p.type || null;
      this.newVilla$(type).pipe(switchMap((v) => this.api.assignTxns(v.id, ids).pipe(switchMap(() => of(v))))).subscribe({
        next: (v) => ok(`a new ${type ? this.typeLabel(type) + ' ' : ''}villa`), error: fail,
      });
    } else {
      const v = this.villas().find((x) => x.id === target);
      this.api.assignTxns(target, ids).subscribe({ next: () => ok(v ? villaLabel(v) : 'the villa'), error: fail });
    }
  }
  unpin(p: Purchase): void {
    if (this.busy()) return;
    this.busy.set(p.key);
    this.api.unassignTxns(p.txns.map((t) => t.order_id)).subscribe({
      next: () => this.after(() => { this.busy.set(null); this.flash('Moved back to “To map”'); }),
      error: () => { this.busy.set(null); this.flash('Couldn’t unpin — try again'); },
    });
  }
  /** pin everything that is still to map, oldest first — suggestions are worked out again after each pin */
  autoMap(): void {
    const next = [...this.todo()].sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next) { this.flash('All mapped'); return; }
    this.pin(next, next.suggest, () => this.autoMap());
  }

  // ── villas ──
  private newVilla$(type: VillaType | null): Observable<ClientVilla> {
    const n = this.villas().length + 1;
    return this.api.createClientVilla(this.code(), `Villa ${n}`).pipe(
      switchMap((v) => (type ? this.api.setVillaType(v.id, type).pipe(switchMap(() => of(v))) : of(v))));
  }
  addVilla(type: VillaType): void {
    if (this.busy()) return;
    this.busy.set('new:' + type);
    this.newVilla$(type).subscribe({
      next: () => this.after(() => { this.busy.set(null); this.flash(`Added an empty ${this.typeLabel(type)} villa`); }),
      error: () => { this.busy.set(null); this.flash('Couldn’t add the villa'); },
    });
  }
  setType(v: ClientVilla, t: VillaType): void {
    if (this.busy() || v.villa_type === t) return;
    this.busy.set(v.id);
    this.api.setVillaType(v.id, t).subscribe({
      next: () => this.after(() => { this.busy.set(null); this.flash(`${villaLabel(v)} is now ${this.typeLabel(t)}`); }),
      error: () => { this.busy.set(null); this.flash('Couldn’t save the type'); },
    });
  }
  removeEmpty(v: ClientVilla): void {
    if (this.busy() || v.txn_count) return;
    this.busy.set(v.id);
    this.api.deleteClientVilla(v.id).subscribe({
      next: () => this.after(() => { this.busy.set(null); this.flash('Removed the empty villa'); }),
      error: () => { this.busy.set(null); this.flash('Couldn’t remove it'); },
    });
  }
  /** reload this client, the counts and the panel's tiles */
  private after(done: () => void): void {
    this.reload(done);
    this.loadOverview();
    this.changed.emit();
  }

  // ── drag & drop ──
  dragStart(e: DragEvent, p: Purchase): void {
    this.dragKey.set(p.key);
    e.dataTransfer?.setData('text/plain', p.key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  dragEnd(): void { this.dragKey.set(null); this.dropOn.set(null); }
  over(e: DragEvent, target: string): void {
    if (!this.dragKey()) return;
    e.preventDefault();
    this.dropOn.set(target);
  }
  drop(e: DragEvent, target: string): void {
    e.preventDefault();
    const p = this.all().find((x) => x.key === this.dragKey());
    this.dragEnd();
    if (!p || p.villaId === target) return;
    this.pin(p, target);
  }

  @HostListener('document:click', ['$event'])
  onDoc(e: MouseEvent): void { if (this.menu() && !(e.target as HTMLElement)?.closest?.('.vm-menu-wrap')) this.menu.set(null); }
  @HostListener('document:keydown.escape') onEsc(): void { this.menu.set(null); }

  // ── formatting ──
  label = villaLabel;
  typeLabel(t: VillaType | null | undefined): string { return TYPES.find((x) => x.key === t)?.label ?? ''; }
  progress(v: ClientVilla): number { return v.finished ? 100 : Math.min(100, (v.mapped_total / VILLA_FULL) * 100); }
  money(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  day(d: string): string {
    return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  }
  name(s: string): string { return (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
  initials(s: string): string { return this.name(s).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join(''); }
  short(n: string): string { return n.replace(/\s*-\s*(Regular|Direct).*$/i, '').replace(/\s+(Fund\s*)?(-\s*)?Growth\s*$/i, '').replace(/\s+Fund\s*$/i, '').trim(); }
  private flash(m: string): void {
    this.toast.set(m);
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toast.set(''), 2200);
  }
}
