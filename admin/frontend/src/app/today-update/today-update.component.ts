import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';

import { AdminService, ReportUpload, TodayStatus } from '../admin.service';

type Kind = 'user' | 'transaction';
type SlotState = 'idle' | 'uploading' | 'done' | 'error';

interface Slot {
  state: SlotState;
  file: string;        // name of the file being read / last added
  error: string;
  justDone: boolean;   // plays the tick animation once
}

const pad = (n: number) => String(n).padStart(2, '0');
/** today in the admin's own timezone (the server runs in UTC) */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Today's update — admin home. Drop today's two daily reports (client details
 * = User Report, transactions = Transaction Report) straight onto the home
 * screen. Both are filed under TODAY's date (the transaction CSV's own first
 * NAV date is often days old). When both are in, a short "Updated for today"
 * moment plays, then the card settles into a slim done bar.
 */
@Component({
  selector: 'app-today-update',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './today-update.component.html',
  styleUrl: './today-update.component.scss',
})
export class TodayUpdateComponent implements OnInit, OnDestroy {
  private api = inject(AdminService);

  /** fires after every successful upload so the home screen re-pulls its figures */
  @Output() updated = new EventEmitter<Kind>();

  readonly today = signal(localToday());
  readonly status = signal<TodayStatus | null>(null);
  readonly loaded = signal(false);
  readonly slots = signal<Record<Kind, Slot>>({
    user: { state: 'idle', file: '', error: '', justDone: false },
    transaction: { state: 'idle', file: '', error: '', justDone: false },
  });
  readonly dragKind = signal<Kind | 'card' | null>(null);
  /** the full-card "Updated for today" moment */
  readonly celebrating = signal(false);
  /** done bar → open the slots again to replace a file */
  readonly reopened = signal(false);
  private timers: any[] = [];
  private dayTimer: any = null;

  ngOnInit(): void {
    this.load();
    // roll over at midnight without a reload
    this.dayTimer = setInterval(() => {
      if (localToday() !== this.today()) { this.today.set(localToday()); this.reopened.set(false); this.load(); }
    }, 60_000);
  }

  ngOnDestroy(): void { clearInterval(this.dayTimer); this.timers.forEach(clearTimeout); }

  load(): void {
    this.api.reportToday(this.today()).subscribe({
      next: (s) => { this.status.set(s); this.loaded.set(true); },
      error: () => this.loaded.set(true),
    });
  }

  // ── derived ───────────────────────────────────────────────────────────────
  upload(kind: Kind): ReportUpload | null { return this.status()?.[kind] ?? null; }
  readonly count = computed(() => (this.status()?.user ? 1 : 0) + (this.status()?.transaction ? 1 : 0));
  readonly complete = computed(() => this.count() === 2);
  readonly busy = computed(() => Object.values(this.slots()).some((s) => s.state === 'uploading'));
  /** slim bar once today is done (unless reopened, uploading, or mid-celebration) */
  readonly collapsed = computed(() => this.complete() && !this.reopened() && !this.busy() && !this.celebrating());

  readonly dateLong = computed(() =>
    new Date(this.today() + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }));
  readonly dateShort = computed(() =>
    new Date(this.today() + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

  readonly lastAt = computed(() => {
    const ts = [this.status()?.user?.uploaded_at, this.status()?.transaction?.uploaded_at].filter(Boolean) as string[];
    if (!ts.length) return '';
    const latest = ts.map((t) => new Date(t)).sort((a, b) => b.getTime() - a.getTime())[0];
    return latest.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  });

  readonly summary = computed(() => {
    const u = this.status()?.user?.row_count, t = this.status()?.transaction?.row_count;
    const parts: string[] = [];
    if (u != null) parts.push(`${u.toLocaleString('en-IN')} client${u === 1 ? '' : 's'}`);
    if (t != null) parts.push(`${t.toLocaleString('en-IN')} transaction${t === 1 ? '' : 's'}`);
    return parts.join(' · ');
  });

  slot(kind: Kind): Slot { return this.slots()[kind]; }

  // ── uploading ─────────────────────────────────────────────────────────────
  onPick(kind: Kind, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.send(kind, f);
  }

  onDragOver(kind: Kind | 'card', ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    this.dragKind.set(kind);
  }

  onDragLeave(ev: DragEvent): void {
    // only clear when the pointer really left the card (not moved onto a child)
    const to = ev.relatedTarget as Node | null;
    if (!to || !(ev.currentTarget as HTMLElement).contains(to)) this.dragKind.set(null);
  }

  /** dropped on one slot → that report; dropped on the card → work out which file is which */
  async onDrop(kind: Kind | 'card', ev: DragEvent): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    this.dragKind.set(null);
    const files = Array.from(ev.dataTransfer?.files || []);
    if (!files.length) return;
    if (kind !== 'card') { this.send(kind, files[0]); return; }
    for (const f of files.slice(0, 2)) {
      const k = await this.guess(f);
      if (k) this.send(k, f);
      else this.fail(files.length === 1 ? 'transaction' : 'user', `Couldn’t tell what “${f.name}” is — drop it on the right box.`);
    }
  }

  /** .xlsx = client details; a .csv with Scheme Name / Units columns = transactions */
  private async guess(f: File): Promise<Kind | null> {
    const ext = this.ext(f);
    if (ext === 'xlsx') return 'user';
    if (ext !== 'csv') return null;
    const head = (await f.slice(0, 2048).text()).split(/\r?\n/)[0].toLowerCase();
    if (head.includes('scheme name') || head.includes('units') || head.includes('nav')) return 'transaction';
    return 'user';
  }

  private ext(f: File): string { return (f.name.split('.').pop() || '').toLowerCase(); }

  private send(kind: Kind, f: File): void {
    const ok = kind === 'user' ? ['xlsx', 'csv'] : ['csv'];
    if (!ok.includes(this.ext(f))) {
      this.fail(kind, `${kind === 'user' ? 'Client details' : 'Transactions'} must be a ${ok.map((e) => '.' + e).join(' or ')} file.`);
      return;
    }
    const wasComplete = this.complete();
    this.setSlot(kind, { state: 'uploading', file: f.name, error: '', justDone: false });
    this.api.uploadReport(kind, f, this.today()).subscribe({
      next: (r) => {
        this.status.update((s) => ({ ...(s || { report_date: this.today(), user: null, transaction: null }), [kind]: r }));
        this.setSlot(kind, { state: 'done', justDone: true });
        this.later(() => this.setSlot(kind, { justDone: false }), 1400);
        this.updated.emit(kind);
        if (this.complete() && (!wasComplete || this.reopened())) this.celebrate();
      },
      error: (e) => {
        const msg = e?.status === 401 ? 'Your session timed out — unlock and try again.'
          : e?.error?.detail || 'Upload failed — check it’s the right file.';
        this.fail(kind, msg);
      },
    });
  }

  private fail(kind: Kind, error: string): void { this.setSlot(kind, { state: 'error', error }); }

  private setSlot(kind: Kind, patch: Partial<Slot>): void {
    this.slots.update((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }));
  }

  private celebrate(): void {
    this.celebrating.set(true);
    this.later(() => { this.celebrating.set(false); this.reopened.set(false); this.resetSlots(); }, 3400);
  }

  skipCelebration(): void { this.celebrating.set(false); this.reopened.set(false); this.resetSlots(); }

  private resetSlots(): void {
    this.slots.set({
      user: { state: 'idle', file: '', error: '', justDone: false },
      transaction: { state: 'idle', file: '', error: '', justDone: false },
    });
  }

  private later(fn: () => void, ms: number): void { this.timers.push(setTimeout(fn, ms)); }

  readonly reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** confetti pieces for the moment (angle, distance, colour, delay) */
  readonly bits = Array.from({ length: 18 }, (_, i) => ({
    a: (360 / 18) * i + (i % 2 ? 6 : -6),
    d: 70 + (i % 3) * 22,
    c: ['var(--brass)', 'var(--positive)', '#e9c46a', 'var(--paper)'][i % 4],
    t: (i % 5) * 40,
  }));
}
