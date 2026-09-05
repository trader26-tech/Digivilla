import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  AdminService,
  AvailabilityDay,
  Booking,
  ClientDoc,
  ClientFolder,
  ClientProfile,
  ClientRow,
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

/** One request placed on the agenda for a given day. */
interface AgendaItem {
  booking: Booking;
  time: string;        // "10:00" for consultations, else the created time
  timeLabel: string;   // "10 am"
  hasSlot: boolean;    // true for scheduled consultations
}
/** A cell in the month grid. */
interface MonthCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  total: number;
  pending: number;
  amount: number;        // total ₹ of that day's requests (for the cell value)
  /** distinct request kinds present that day, for the colored dots */
  kinds: string[];
  topKind: string;       // the dominant kind that day (drives the cell tint)
}
/** The order kinds are shown in dots/legend and their accent tokens. */
const KIND_ORDER = ['consultation', 'sip', 'buy', 'withdraw'] as const;
/** Human labels + accents per request kind. */
const KIND_META: Record<string, { label: string; verb: string; icon: string }> = {
  consultation: { label: 'Consultation', verb: 'wants a call about', icon: '📞' },
  sip:          { label: 'SIP',          verb: 'wants to start an SIP in', icon: '🔁' },
  buy:          { label: 'Buy',          verb: 'wants to own', icon: '🏠' },
  withdraw:     { label: 'Withdraw',     verb: 'wants to withdraw from', icon: '💸' },
};

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

  // calendar (day agenda + month overview)
  selectedDate = signal<string>(this.isoOf(new Date()));   // day shown in the agenda
  viewMonth = signal<{ y: number; m: number }>({ y: new Date().getFullYear(), m: new Date().getMonth() });
  kindFilter = signal<'all' | 'consultation' | 'sip' | 'buy' | 'withdraw'>('all');
  readonly kindMeta = KIND_META;

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

  // CRM — full client profiles (the Clients tab)
  crmClients = signal<ClientRow[]>([]);
  crmLoading = signal(false);
  crmSearch = signal('');
  crmActive = signal<ClientProfile | null>(null);
  crmDetailLoading = signal(false);

  /** clients filtered by the search box (name or phone). */
  filteredClients = computed<ClientRow[]>(() => {
    const q = this.crmSearch().trim().toLowerCase();
    const list = this.crmClients();
    if (!q) return list;
    return list.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
  });

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
    this.loadCrmClients();
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

  // ═══════════════════════════ CALENDAR ═══════════════════════════

  /** The ISO day a booking belongs on: its slot day for consultations,
   *  otherwise the day it was submitted (created_at). */
  private dayOf(b: Booking): string {
    const s = this.splitSlot(b.slot);
    if (s.day) return s.day;
    const d = new Date(b.created_at);
    return isNaN(d.getTime()) ? '' : this.isoOf(d);
  }
  private timeOf(b: Booking): string {
    const s = this.splitSlot(b.slot);
    if (s.time) return s.time;
    const d = new Date(b.created_at);
    return isNaN(d.getTime()) ? '00:00' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** bookings grouped by ISO day, honouring the kind filter. */
  private byDayMap = computed<Map<string, Booking[]>>(() => {
    const filter = this.kindFilter();
    const m = new Map<string, Booking[]>();
    for (const b of this.bookings()) {
      if (filter !== 'all' && b.kind !== filter) continue;
      const iso = this.dayOf(b);
      if (!iso) continue;
      if (!m.has(iso)) m.set(iso, []);
      m.get(iso)!.push(b);
    }
    return m;
  });

  /** The month grid (6 weeks) for the currently-viewed month. */
  monthGrid = computed<MonthCell[]>(() => {
    const { y, m } = this.viewMonth();
    const todayIso = this.isoOf(new Date());
    const first = new Date(y, m, 1);
    // Grid starts on the Monday on/before the 1st.
    const offset = (first.getDay() + 6) % 7; // 0=Mon
    const start = new Date(y, m, 1 - offset);
    const byDay = this.byDayMap();
    const cells: MonthCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = this.isoOf(d);
      const items = byDay.get(iso) || [];
      // distinct kinds present that day, in a stable display order
      const present = new Set(items.map((b) => b.kind));
      const kinds = KIND_ORDER.filter((k) => present.has(k));
      // dominant kind (most frequent) for the cell tint
      const counts: Record<string, number> = {};
      for (const b of items) counts[b.kind] = (counts[b.kind] || 0) + 1;
      const topKind = kinds.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0] || '';
      cells.push({
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === m,
        isToday: iso === todayIso,
        isPast: iso < todayIso,
        total: items.length,
        pending: items.filter((b) => b.status === 'requested').length,
        amount: items.reduce((s, b) => s + (b.amount || 0), 0),
        kinds,
        topKind,
      });
    }
    return cells;
  });

  monthLabel = computed<string>(() => {
    const { y, m } = this.viewMonth();
    return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m]} ${y}`;
  });

  /** Compact ₹ for tight calendar cells: ₹5k, ₹1.2L, ₹3Cr. */
  moneyShort(v: number): string {
    if (!v) return '';
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)}Cr`;
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)}L`;
    if (v >= 1e3) return `₹${(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}k`;
    return `₹${Math.round(v)}`;
  }

  /** This month's totals for the summary header (by request kind + value). */
  monthSummary = computed(() => {
    const { y, m } = this.viewMonth();
    let total = 0, pending = 0, value = 0;
    const byKind: Record<string, number> = { consultation: 0, sip: 0, buy: 0, withdraw: 0 };
    for (const b of this.bookings()) {
      const iso = this.dayOf(b);
      const d = this.parseIso(iso);
      if (!d || d.getFullYear() !== y || d.getMonth() !== m) continue;
      total++;
      if (b.status === 'requested') pending++;
      value += b.amount || 0;
      if (b.kind in byKind) byKind[b.kind]++;
    }
    return { total, pending, value, byKind };
  });

  /** The agenda for the selected day, sorted by time, newest-status first. */
  agenda = computed<AgendaItem[]>(() => {
    const iso = this.selectedDate();
    const items = (this.byDayMap().get(iso) || []).map((b) => {
      const t = this.timeOf(b);
      return { booking: b, time: t, timeLabel: this.timeLabel(t), hasSlot: !!this.splitSlot(b.slot).time };
    });
    return items.sort((a, z) => a.time.localeCompare(z.time));
  });

  selectedDayLabel = computed<string>(() => {
    const d = this.parseIso(this.selectedDate());
    if (!d) return this.selectedDate();
    const today = this.isoOf(new Date());
    const prefix = this.selectedDate() === today ? 'Today · ' : '';
    return `${prefix}${WK[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
  });

  /** Full working-hours timeline for the selected day, split into 30-min slots.
   *  Each slot carries its busy/free state (from availability) and any requests
   *  that fall in that half-hour window. This is the "glance my whole day" view. */
  daySlots = computed(() => {
    const iso = this.selectedDate();
    const start = this.avStart() || '10:00';
    const end = this.avEnd() || '18:00';
    const blocked = new Set(this.blockedSet());
    const filter = this.kindFilter();

    // bucket the day's requests by their half-hour slot start ("HH:MM")
    const reqBy = new Map<string, Booking[]>();
    for (const b of (this.byDayMap().get(iso) || [])) {
      if (filter !== 'all' && b.kind !== filter) continue;
      const t = this.timeOf(b);
      const half = this.floorHalfHour(t);
      if (!reqBy.has(half)) reqBy.set(half, []);
      reqBy.get(half)!.push(b);
    }

    const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
    const rows: {
      time: string; label: string; iso: string; blocked: boolean; requests: Booking[];
    }[] = [];
    for (let t = toMin(start); t < toMin(end); t += 30) {
      const hm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const slotIso = `${iso}T${hm}:00+05:30`;
      rows.push({
        time: hm,
        label: this.timeLabel(hm),
        iso: slotIso,
        blocked: blocked.has(slotIso),
        requests: reqBy.get(hm) || [],
      });
    }
    return rows;
  });

  /** the set of blocked slot ISO strings, kept in a signal for reactivity */
  blockedSet = signal<string[]>([]);

  private floorHalfHour(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const mm = m >= 30 ? 30 : 0;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** Toggle a 30-min slot busy/free for the selected day (e.g. block 12–1pm for gym). */
  toggleDaySlot(slotIso: string, currentlyBlocked: boolean): void {
    const next = !currentlyBlocked;
    this.avBusySlot.set(slotIso);
    this.api.blockSlot(slotIso, next).subscribe({
      next: (r) => { this.blockedSet.set(r.blocked || []); this.avBusySlot.set(''); },
      error: () => this.avBusySlot.set(''),
    });
  }

  /** counts for the selected day, for the little header summary. */
  daySummary = computed<{ total: number; pending: number }>(() => {
    const items = this.byDayMap().get(this.selectedDate()) || [];
    return { total: items.length, pending: items.filter((b) => b.status === 'requested').length };
  });

  selectDay(iso: string): void { this.selectedDate.set(iso); }
  isSelected(iso: string): boolean { return this.selectedDate() === iso; }

  /** "Needs your attention" feed — every still-requested item, newest first,
   *  honouring the kind filter. This is what the admin should act on now. */
  notifications = computed<AgendaItem[]>(() => {
    const filter = this.kindFilter();
    return this.bookings()
      .filter((b) => b.status === 'requested' && (filter === 'all' || b.kind === filter))
      .map((b) => {
        const t = this.timeOf(b);
        return { booking: b, time: t, timeLabel: this.timeLabel(t), hasSlot: !!this.splitSlot(b.slot).time };
      })
      .sort((a, z) => (z.booking.created_at || '').localeCompare(a.booking.created_at || ''));
  });

  /** Count of new requests per kind, for the quick-action / filter badges. */
  newByKind = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: 0, consultation: 0, sip: 0, buy: 0, withdraw: 0 };
    for (const b of this.bookings()) {
      if (b.status !== 'requested') continue;
      counts['all']++;
      if (counts[b.kind] != null) counts[b.kind]++;
    }
    return counts;
  });

  /** Total documents across all client folders — for the Clients quick-action. */
  get totalDocs(): number { return this.clients().reduce((n, c) => n + (c.count || 0), 0); }

  /** True if the notification is dated today — used to surface "new today". */
  isTodayItem(a: AgendaItem): boolean { return this.dayOf(a.booking) === this.isoOf(new Date()); }

  /** Jump the calendar to a notification's day and select it. */
  jumpTo(a: AgendaItem): void {
    const iso = this.dayOf(a.booking);
    if (!iso) return;
    const d = this.parseIso(iso);
    if (d) this.viewMonth.set({ y: d.getFullYear(), m: d.getMonth() });
    this.selectedDate.set(iso);
  }

  /** A short "how long ago" label for a request. */
  ago(created: string): string {
    const then = new Date(created).getTime();
    if (isNaN(then)) return '';
    const mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
  }

  prevMonth(): void {
    this.viewMonth.update(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  }
  nextMonth(): void {
    this.viewMonth.update(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  }
  goToday(): void {
    const now = new Date();
    this.viewMonth.set({ y: now.getFullYear(), m: now.getMonth() });
    this.selectedDate.set(this.isoOf(now));
  }
  setKindFilter(k: 'all' | 'consultation' | 'sip' | 'buy' | 'withdraw'): void { this.kindFilter.set(k); }

  kindLabel(b: Booking): string { return (KIND_META[b.kind] || KIND_META['consultation']).label; }
  kindIcon(b: Booking): string { return (KIND_META[b.kind] || KIND_META['consultation']).icon; }
  requirementLine(b: Booking): string {
    const meta = KIND_META[b.kind] || KIND_META['consultation'];
    const what = this.propLabel(b) || (b.property || 'a Digivilla');
    const amt = b.amount ? ` · ${this.money(b.amount)}${b.kind === 'sip' ? '/mo' : ''}` : '';
    return `${meta.verb} ${what}${amt}`;
  }

  // ═══════════════════════════ AVAILABILITY ═══════════════════════════
  loadAvailability(): void {
    this.api.availability(62).subscribe({
      next: (r) => {
        this.avDays.set(r.days);
        this.avStart.set(r.config.start);
        this.avEnd.set(r.config.end);
        this.avWeekdays.set(r.config.weekdays);
        // gather every blocked slot ISO across the returned days for the day view
        const blocked: string[] = [];
        for (const d of r.days) for (const s of d.slots) if (s.blocked) blocked.push(s.slot);
        this.blockedSet.set(blocked);
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

  // ═══════════════════════════ CRM (Clients tab) ═══════════════════════════
  loadCrmClients(): void {
    this.crmLoading.set(true);
    this.api.listCrmClients().subscribe({
      next: (c) => { this.crmClients.set(c); this.crmLoading.set(false); },
      error: (e) => { this.crmLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }

  openCrmClient(id: string): void {
    this.crmDetailLoading.set(true);
    this.crmActive.set(null);
    this.api.getCrmClient(id).subscribe({
      next: (p) => { this.crmActive.set(p); this.crmDetailLoading.set(false); },
      error: (e) => { this.crmDetailLoading.set(false); if (e?.status === 401) this.lock(); },
    });
  }

  closeCrmClient(): void { this.crmActive.set(null); }

  /** Upload a document to the currently-open CRM client (by their name). */
  onCrmFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    const client = this.crmActive();
    if (!file || !client) return;
    this.uploading.set(true);
    this.docError.set('');
    this.api.uploadDocument(client.name, file).subscribe({
      next: (doc) => {
        this.crmActive.update((p) => p ? { ...p, documents: [doc, ...p.documents] } : p);
        this.uploading.set(false);
        input.value = '';
      },
      error: (e) => {
        this.docError.set(e?.error?.detail || 'Upload failed. Try again.');
        this.uploading.set(false);
        input.value = '';
      },
    });
  }

  removeCrmDoc(doc: ClientDoc): void {
    this.api.deleteDocument(doc.id).subscribe({
      next: () => this.crmActive.update((p) =>
        p ? { ...p, documents: p.documents.filter((d) => d.id !== doc.id) } : p),
      error: () => this.docError.set('Could not delete that document.'),
    });
  }

  kindMetaFor(kind: string) { return KIND_META[kind] || KIND_META['consultation']; }
  pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%`; }

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
    const prop = b.property || 'Digivilla';
    // Consultations reserve N plots; SIP/buy/withdraw are about the Digivilla itself.
    if (b.kind === 'consultation') {
      return `${b.plots} × ${v} ${prop}`.replace(/\s+/g, ' ').trim();
    }
    return `${v} ${prop}`.replace(/\s+/g, ' ').trim();
  }
}
