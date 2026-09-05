import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  AdminService,
  AvailabilityDay,
  Booking,
  ClientDoc,
  ClientFolder,
} from './admin.service';

type Phase = 'loading' | 'email' | 'otp' | 'setpin' | 'pin' | 'unlocked';
type Tab = 'calendar' | 'documents';

interface DayGroup {
  iso: string;
  label: string;
  isToday: boolean;
  slots: SlotCell[];
}
interface SlotCell {
  time: string;
  label: string;
  booking: Booking | null;
}

const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // 0..6 = Mon..Sun

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private api = inject(AdminService);

  // ── auth state machine ─────────────────────────────────────────────────────
  phase = signal<Phase>('loading');
  busy = signal(false);
  authError = signal('');
  notice = signal('');
  signinEmail = signal('');        // masked address codes go to
  maskedEmail = signal('');
  hasPin = signal(false);
  lockMinutes = signal(30);
  lockPresets = signal<number[]>([10, 30, 60, 120]);

  otpCode = signal('');
  pinInput = signal('');
  pin2Input = signal('');

  private exp = 0;
  private tick: any = null;
  secondsLeft = signal<number | null>(null);
  private lastRefresh = 0;
  private activityBound = false;

  // ── dashboard ──────────────────────────────────────────────────────────────
  tab = signal<Tab>('calendar');

  // bookings
  bookings = signal<Booking[]>([]);
  loading = signal(false);
  loadError = signal('');
  busyId = signal('');

  // availability
  avDays = signal<AvailabilityDay[]>([]);
  avStart = signal('10:00');
  avEnd = signal('18:00');
  avWeekdays = signal<number[]>([0, 1, 2, 3, 4, 5]);
  avSavingCfg = signal(false);
  avBusySlot = signal('');
  showAvailability = signal(false);
  readonly weekdayLabels = WEEKDAY_LABELS;

  // documents
  clients = signal<ClientFolder[]>([]);
  docsLoading = signal(false);
  activeClient = signal<string>('');
  clientDocs = signal<ClientDoc[]>([]);
  newClientName = signal('');
  uploading = signal(false);
  docError = signal('');

  ngOnInit(): void {
    this.initAuth();
  }

  // ═══════════════════════════ AUTH ═══════════════════════════
  private initAuth(): void {
    const now = Math.floor(Date.now() / 1000);
    const storedExp = this.api.storedExp;
    this.api.session().subscribe({
      next: (s) => {
        this.hasPin.set(!!s.has_pin);
        this.lockMinutes.set(s.lock_minutes || 30);
        this.lockPresets.set(s.lock_presets || this.lockPresets());
        if (s.email) this.maskedEmail.set(s.email);
        if (s.signin_email) this.signinEmail.set(s.signin_email);

        if (this.api.token && storedExp > now + 5 && s.device_known) {
          this.exp = storedExp;
          this.enterUnlocked();
          return;
        }
        this.api.clearToken();
        this.phase.set(s.device_known && s.has_pin ? 'pin' : 'email');
      },
      error: () => {
        // Offline / server down → let them try email sign-in.
        this.phase.set('email');
      },
    });
  }

  sendCode(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.notice.set('');
    this.api.requestOtp('').subscribe({
      next: (r) => {
        this.maskedEmail.set(r.masked || this.signinEmail());
        this.notice.set(r.emailed ? '' : 'Dev mode: code printed to the server log.');
        this.phase.set('otp');
        this.busy.set(false);
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Could not send the code. Try again.');
        this.busy.set(false);
      },
    });
  }

  verifyCode(): void {
    const code = this.otpCode().trim();
    if (code.length < 6 || this.busy()) {
      if (code.length < 6) this.authError.set('Enter the 6-digit code.');
      return;
    }
    this.busy.set(true);
    this.authError.set('');
    this.api.verifyOtp('', code).subscribe({
      next: (r) => {
        this.api.store(r.access_token, r.expires_at);
        this.exp = r.expires_at;
        this.lockMinutes.set(r.lock_minutes || 30);
        this.lockPresets.set(r.lock_presets || this.lockPresets());
        this.hasPin.set(!!r.has_pin);
        if (r.email) this.maskedEmail.set(r.email);
        this.otpCode.set('');
        this.busy.set(false);
        if (r.has_pin) this.enterUnlocked();
        else this.phase.set('setpin');
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Incorrect or expired code.');
        this.busy.set(false);
      },
    });
  }

  createPin(): void {
    const p = this.pinInput().trim();
    if (!/^\d{4}$/.test(p)) { this.authError.set('PIN must be exactly 4 digits.'); return; }
    if (p !== this.pin2Input().trim()) { this.authError.set('The two PINs don’t match.'); return; }
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.api.setPin(p).subscribe({
      next: () => {
        this.hasPin.set(true);
        this.pinInput.set('');
        this.pin2Input.set('');
        this.busy.set(false);
        this.enterUnlocked();
      },
      error: (e) => {
        this.authError.set(e?.error?.detail || 'Could not set the PIN.');
        this.busy.set(false);
      },
    });
  }

  doUnlock(): void {
    const p = this.pinInput().trim();
    if (!p) { this.authError.set('Enter your PIN.'); return; }
    if (this.busy()) return;
    this.busy.set(true);
    this.authError.set('');
    this.api.unlock(p).subscribe({
      next: (r) => {
        this.api.store(r.access_token, r.expires_at);
        this.exp = r.expires_at;
        this.lockMinutes.set(r.lock_minutes || this.lockMinutes());
        this.pinInput.set('');
        this.busy.set(false);
        this.enterUnlocked();
      },
      error: (e) => {
        const detail = e?.error?.detail || 'Incorrect PIN.';
        this.authError.set(detail);
        this.busy.set(false);
        if (/email/i.test(detail)) { this.hasPin.set(false); this.phase.set('email'); }
      },
    });
  }

  useEmailInstead(): void {
    this.authError.set('');
    this.pinInput.set('');
    this.phase.set('email');
  }

  private enterUnlocked(): void {
    this.authError.set('');
    this.notice.set('');
    this.phase.set('unlocked');
    if (this.tick) clearInterval(this.tick);
    this.bindActivity();
    this.tick = setInterval(() => this.heartbeat(), 1000);
    this.heartbeat();
    this.refresh();
    this.loadAvailability();
    this.loadClients();
  }

  private bindActivity(): void {
    if (this.activityBound || typeof document === 'undefined') return;
    this.activityBound = true;
    const mark = () => this.maybeRefresh();
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((ev) =>
      document.addEventListener(ev, mark, { passive: true }));
  }

  private maybeRefresh(): void {
    if (this.phase() !== 'unlocked') return;
    const now = Math.floor(Date.now() / 1000);
    const windowSec = this.lockMinutes() * 60;
    if (this.exp - now < windowSec / 2 && Date.now() - this.lastRefresh > 30_000) {
      this.slideToken();
    }
  }
  private slideToken(): void {
    this.lastRefresh = Date.now();
    this.api.refresh().subscribe({
      next: (r) => { this.api.store(r.access_token, r.expires_at); this.exp = r.expires_at; },
      error: () => this.lock(),
    });
  }

  private heartbeat(): void {
    if (this.phase() !== 'unlocked') return;
    const secsLeft = this.exp - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) { this.lock(); return; }
    this.secondsLeft.set(secsLeft);
  }

  lock(): void {
    this.api.clearToken();
    this.secondsLeft.set(null);
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    this.authError.set('');
    this.notice.set('');
    this.phase.set(this.hasPin() ? 'pin' : 'email');
  }

  signOut(): void {
    this.api.logoutDevice().subscribe({ next: () => {}, error: () => {} });
    this.api.clearToken();
    this.hasPin.set(false);
    if (this.tick) { clearInterval(this.tick); this.tick = null; }
    this.bookings.set([]);
    this.phase.set('email');
  }

  changeLock(mins: number): void {
    this.api.setLockMinutes(mins).subscribe({
      next: (r) => { this.lockMinutes.set(r.lock_minutes); this.slideToken(); },
      error: () => {},
    });
  }

  lockCountdown = computed<string>(() => {
    const s = this.secondsLeft();
    if (s === null) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  });

  // ═══════════════════════════ BOOKINGS ═══════════════════════════
  refresh(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api.listBookings().subscribe({
      next: (b) => { this.bookings.set(b); this.loading.set(false); },
      error: (e) => {
        this.loading.set(false);
        if (e?.status === 401) this.lock();
        else this.loadError.set('Could not load bookings.');
      },
    });
  }

  confirm(b: Booking): void { this.update(b, 'confirmed'); }
  decline(b: Booking): void { this.update(b, 'declined'); }
  reopen(b: Booking): void { this.update(b, 'requested'); }
  private update(b: Booking, status: 'confirmed' | 'declined' | 'requested'): void {
    this.busyId.set(b.id);
    this.api.setStatus(b.id, status).subscribe({
      next: (u) => {
        this.bookings.update((list) => list.map((x) => (x.id === b.id ? u : x)));
        this.busyId.set('');
      },
      error: () => this.busyId.set(''),
    });
  }

  get requestedCount(): number { return this.bookings().filter((b) => b.status === 'requested').length; }
  get confirmedCount(): number { return this.bookings().filter((b) => b.status === 'confirmed').length; }

  days = computed<DayGroup[]>(() => {
    const todayIso = this.isoOf(new Date());
    const byDay = new Map<string, Map<string, Booking>>();
    for (const b of this.bookings()) {
      const { day, time } = this.splitSlot(b.slot);
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, new Map());
      byDay.get(day)!.set(time, b);
    }
    const out: DayGroup[] = [];
    for (const iso of [...byDay.keys()].sort()) {
      const d = this.parseIso(iso);
      const times = [...byDay.get(iso)!.keys()].sort();
      out.push({
        iso,
        label: d ? `${WK[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}` : iso,
        isToday: iso === todayIso,
        slots: times.map((t) => ({ time: t, label: this.timeLabel(t), booking: byDay.get(iso)!.get(t)! })),
      });
    }
    return out;
  });

  // ═══════════════════════════ AVAILABILITY ═══════════════════════════
  loadAvailability(): void {
    this.api.availability(14).subscribe({
      next: (r) => {
        this.avDays.set(r.days);
        this.avStart.set(r.config.start);
        this.avEnd.set(r.config.end);
        this.avWeekdays.set(r.config.weekdays);
      },
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }

  toggleWeekday(wd: number): void {
    this.avWeekdays.update((list) =>
      list.includes(wd) ? list.filter((x) => x !== wd) : [...list, wd].sort((a, b) => a - b));
  }
  isWeekdayOn(wd: number): boolean { return this.avWeekdays().includes(wd); }

  saveWindow(): void {
    if (this.avSavingCfg()) return;
    this.avSavingCfg.set(true);
    this.api.saveAvailabilityConfig({
      start: this.avStart(), end: this.avEnd(), weekdays: this.avWeekdays(),
    }).subscribe({
      next: () => { this.avSavingCfg.set(false); this.loadAvailability(); },
      error: () => this.avSavingCfg.set(false),
    });
  }

  toggleSlot(day: AvailabilityDay, slot: { slot: string; blocked: boolean }): void {
    const next = !slot.blocked;
    this.avBusySlot.set(slot.slot);
    this.api.blockSlot(slot.slot, next).subscribe({
      next: () => {
        this.avDays.update((days) =>
          days.map((d) => d.date !== day.date ? d : {
            ...d,
            slots: d.slots.map((s) => s.slot === slot.slot ? { ...s, blocked: next } : s),
          }));
        this.avBusySlot.set('');
      },
      error: () => this.avBusySlot.set(''),
    });
  }

  dayLabel(iso: string): string {
    const d = this.parseIso(iso);
    return d ? `${WK[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}` : iso;
  }
  freeCount(day: AvailabilityDay): number { return day.slots.filter((s) => !s.blocked).length; }

  // ═══════════════════════════ DOCUMENTS ═══════════════════════════
  loadClients(): void {
    this.docsLoading.set(true);
    this.api.listClients().subscribe({
      next: (c) => {
        this.clients.set(c);
        this.docsLoading.set(false);
        if (!this.activeClient() && c.length) this.openClient(c[0].client);
      },
      error: (e) => { this.docsLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }

  addClient(): void {
    const name = this.newClientName().trim();
    if (!name) return;
    this.api.createClient(name).subscribe({
      next: () => {
        this.newClientName.set('');
        this.loadClients();
        this.openClient(name);
      },
      error: (e) => this.docError.set(e?.error?.detail || 'Could not add client.'),
    });
  }

  openClient(name: string): void {
    this.activeClient.set(name);
    this.clientDocs.set([]);
    this.docError.set('');
    this.api.listDocuments(name).subscribe({
      next: (d) => this.clientDocs.set(d),
      error: (e) => { if (e?.status === 401) this.lock(); },
    });
  }

  onFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file || !this.activeClient()) return;
    this.uploading.set(true);
    this.docError.set('');
    this.api.uploadDocument(this.activeClient(), file).subscribe({
      next: (doc) => {
        this.clientDocs.update((list) => [doc, ...list]);
        this.uploading.set(false);
        input.value = '';
        this.refreshClientCounts();
      },
      error: (e) => {
        this.docError.set(e?.error?.detail || 'Upload failed. Try again.');
        this.uploading.set(false);
        input.value = '';
      },
    });
  }

  openDoc(doc: ClientDoc): void {
    this.api.downloadDocument(doc.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.docError.set('Could not open that document.'),
    });
  }

  removeDoc(doc: ClientDoc): void {
    this.api.deleteDocument(doc.id).subscribe({
      next: () => {
        this.clientDocs.update((list) => list.filter((d) => d.id !== doc.id));
        this.refreshClientCounts();
      },
      error: () => this.docError.set('Could not delete that document.'),
    });
  }

  private refreshClientCounts(): void {
    this.api.listClients().subscribe({ next: (c) => this.clients.set(c), error: () => {} });
  }

  // ═══════════════════════════ helpers ═══════════════════════════
  private isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  private parseIso(iso: string): Date | null {
    const p = iso.split('-').map(Number);
    return p.length === 3 ? new Date(p[0], p[1] - 1, p[2]) : null;
  }
  private splitSlot(slot: string): { day: string; time: string } {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(slot || '');
    return m ? { day: m[1], time: m[2] } : { day: '', time: '' };
  }
  timeLabel(t: string): string {
    const [hh, mm] = t.split(':');
    const h = parseInt(hh, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return mm === '00' ? `${h12} ${ampm}` : `${h12}:${mm} ${ampm}`;
  }
  fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  money(v: number): string {
    if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1).replace(/\.0$/, '')} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }
  propLabel(b: Booking): string {
    const v = b.variant ? b.variant[0].toUpperCase() + b.variant.slice(1) : '';
    return `${b.plots} × ${v} ${b.property}`.replace(/\s+/g, ' ').trim();
  }
}
