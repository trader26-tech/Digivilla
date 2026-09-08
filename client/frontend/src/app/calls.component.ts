import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth/auth.service';
import { BookingService, Booking } from './booking.service';
import { EstateService } from './estate.service';
import { PresentationComponent } from './presentation.component';

/** A call, shaped for the list: parsed date/time + friendly labels. */
interface CallItem {
  booking: Booking;
  when: number;         // epoch ms of the slot (or created_at fallback)
  dateLabel: string;    // "Wed, 10 Sep"
  timeLabel: string;    // "10:30 am"
  status: string;       // requested | confirmed | declined
  meetLink: string;
  note: string;         // the review type, e.g. "Quarterly review"
  upcoming: boolean;
}

/** One kind of call the user can request from the fund manager. */
interface CallReason {
  key: string;
  title: string;
  blurb: string;
  icon: string;         // inline emoji marker
}

/** A day of free slots, ready for the picker. */
interface FreeDay {
  date: string;                 // YYYY-MM-DD
  label: string;                // "Today", "Tomorrow", "Wed 10"
  slots: { time: string; slot: string }[];
}

/**
 * Calls tab — the user's fund-manager calls, and the place to schedule one.
 *
 * A "+" on the header opens a two-step sheet: pick WHY (quarterly review,
 * portfolio review, a quick question…), then pick a real FREE slot from the
 * fund manager's calendar. Booking posts a consultation request and drops
 * straight into the call log.
 */
@Component({
  selector: 'app-calls',
  standalone: true,
  imports: [CommonModule, PresentationComponent],
  templateUrl: './calls.component.html',
  styleUrl: './calls.component.scss',
})
export class CallsComponent implements OnInit {
  private auth = inject(AuthService);
  private bookings = inject(BookingService);
  readonly est = inject(EstateService);

  @Output() signOut = new EventEmitter<void>();
  /** The shell asks the page to open the scheduler on a reason (e.g. from a
   *  villa's "Own this villa"). Setter fires once the value arrives. */
  @Input() set autoOpenReason(reason: string | null) {
    if (!reason) return;
    // defer so the view is ready before we pop the sheet
    queueMicrotask(() => {
      const match = this.REASONS.find((r) => r.key === reason) || this.REASONS[0];
      this.openSheet();
      this.pickReason(match);
      this.opened.emit();
    });
  }
  @Output() opened = new EventEmitter<void>();
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;

  loading = signal(true);
  raw = signal<Booking[]>([]);

  /** The user's contact details for the profile header. */
  get userPhone(): string {
    return this.est.profile().phone || this.auth.user()?.phone || '';
  }
  get userName(): string {
    return this.est.profile().name || this.auth.user()?.name || 'You';
  }
  get userCity(): string { return this.est.profile().city || ''; }
  get initial(): string { return (this.userName || 'U').charAt(0).toUpperCase(); }

  /** Phone shown to the human — normalised to a single +91 and spaced. */
  get phonePretty(): string {
    let p = (this.userPhone || '').trim();
    p = p.replace(/^\+?91/, '').replace(/\D/g, '');
    if (!p) return '';
    return p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : `+91 ${p}`;
  }

  ngOnInit(): void { this.load(); }

  // profile photo upload (same technique as the account page)
  pickPhoto(): void { this.photoInput?.nativeElement.click(); }
  onPhotoChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const photo = typeof reader.result === 'string' ? reader.result : undefined;
      if (photo) this.est.setProfile({ photo });
    };
    reader.readAsDataURL(file);
    input.value = '';
  }
  doSignOut(): void { this.signOut.emit(); }

  load(): void {
    const phone = this.auth.user()?.phone || this.userPhone;
    if (!phone) { this.loading.set(false); return; }
    this.loading.set(true);
    this.bookings.mine(phone).subscribe({
      next: (b) => { this.raw.set(b || []); this.loading.set(false); },
      error: () => { this.raw.set([]); this.loading.set(false); },
    });
  }

  /** Only consultation bookings that carry a real slot = actual calls. */
  private calls = computed<CallItem[]>(() => {
    const now = Date.now();
    return this.raw()
      .filter((b) => (b.kind || 'consultation') === 'consultation' && !!b.slot)
      .map((b) => {
        const when = this.parseSlot(b.slot!);
        return {
          booking: b, when,
          dateLabel: this.dateLabel(when),
          timeLabel: this.timeLabel(when),
          status: b.status || 'requested',
          meetLink: b.meet_link || '',
          note: (b.note || '').trim(),
          upcoming: when >= now - 30 * 60_000,   // grace: still "upcoming" 30m after start
        } as CallItem;
      });
  });

  upcoming = computed<CallItem[]>(() =>
    this.calls().filter((c) => c.upcoming).sort((a, z) => a.when - z.when));
  past = computed<CallItem[]>(() =>
    this.calls().filter((c) => !c.upcoming).sort((a, z) => z.when - a.when));

  /** The single next call (for the hero card). */
  next = computed<CallItem | null>(() => this.upcoming()[0] || null);

  hasAny = computed<boolean>(() => this.calls().length > 0);

  join(link: string): void {
    if (link) window.open(link, '_blank', 'noopener');
  }

  // ── presentation overlay ──
  presenting = signal(false);
  openPresentation(): void { this.presenting.set(true); if (navigator.vibrate) navigator.vibrate(6); }
  closePresentation(): void { this.presenting.set(false); }

  statusText(s: string): string {
    return s === 'confirmed' ? 'Confirmed' : s === 'declined' ? 'Declined' : 'Requested';
  }

  // ============================ SCHEDULE A CALL ============================
  /** The kinds of call a user can request. Quarterly review comes first — the
   *  brief: "every quarter a call has to be scheduled". */
  readonly REASONS: CallReason[] = [
    { key: 'Quarterly review', title: 'Quarterly review', blurb: 'Your regular check-in on returns, rent and rebalancing.', icon: '📅' },
    { key: 'Portfolio review', title: 'Portfolio review', blurb: 'Go through your villas, holdings and where the money sits.', icon: '📊' },
    { key: 'Add / increase SIP', title: 'Add or increase SIP', blurb: 'Start a new villa or top up a monthly SIP.', icon: '➕' },
    { key: 'Withdraw / rent', title: 'Withdraw or rent', blurb: 'Plan a withdrawal or set up your monthly rent payout.', icon: '💸' },
    { key: 'General question', title: 'Something else', blurb: 'A quick question for your fund manager.', icon: '💬' },
  ];

  /** Sheet state. step 0 = closed, 1 = pick reason, 2 = pick slot, 3 = done. */
  sheetStep = signal<0 | 1 | 2 | 3>(0);
  chosenReason = signal<CallReason | null>(null);
  chosenSlot = signal<{ time: string; slot: string; date: string } | null>(null);

  slotsLoading = signal(false);
  freeDays = signal<FreeDay[]>([]);
  activeDay = signal(0);
  booking = signal(false);
  bookErr = signal('');

  openSheet(): void {
    this.chosenReason.set(null);
    this.chosenSlot.set(null);
    this.bookErr.set('');
    this.sheetStep.set(1);
    if (navigator.vibrate) navigator.vibrate(6);
  }
  closeSheet(): void { this.sheetStep.set(0); }

  pickReason(r: CallReason): void {
    this.chosenReason.set(r);
    this.sheetStep.set(2);
    this.loadSlots();
    if (navigator.vibrate) navigator.vibrate(4);
  }
  backToReason(): void { this.sheetStep.set(1); }

  /** Pull the fund manager's real free slots for the next several days. */
  loadSlots(): void {
    if (this.freeDays().length) return;  // cache within the sheet session
    this.slotsLoading.set(true);
    this.bookings.freeDays(6).subscribe({
      next: (r) => {
        const days: FreeDay[] = (r.days || [])
          .filter((d) => d.slots && d.slots.length)
          .map((d) => ({ ...d, label: this.dayChip(d.date) }));
        this.freeDays.set(days);
        this.activeDay.set(0);
        this.slotsLoading.set(false);
      },
      error: () => { this.freeDays.set([]); this.slotsLoading.set(false); },
    });
  }

  get currentDay(): FreeDay | null { return this.freeDays()[this.activeDay()] || null; }

  pickDay(i: number): void { this.activeDay.set(i); this.chosenSlot.set(null); }

  pickSlot(s: { time: string; slot: string }): void {
    const d = this.currentDay;
    if (!d) return;
    this.chosenSlot.set({ ...s, date: d.date });
    if (navigator.vibrate) navigator.vibrate(4);
  }

  isChosen(s: { slot: string }): boolean { return this.chosenSlot()?.slot === s.slot; }

  /** Book the chosen slot — posts a consultation request, refreshes the log. */
  confirmBooking(): void {
    const reason = this.chosenReason();
    const slot = this.chosenSlot();
    if (!reason || !slot) return;
    const phone = this.userPhone;
    if (!phone) { this.bookErr.set('We need your phone number to book. Add it on your profile.'); return; }

    this.booking.set(true);
    this.bookErr.set('');
    this.bookings.createBooking({
      name: this.userName,
      phone,
      kind: 'consultation',
      property: 'villa',
      variant: reason.key,
      plots: 1,
      slot: slot.slot,
      note: reason.key,
    }).subscribe({
      next: () => {
        this.booking.set(false);
        this.sheetStep.set(3);          // success screen
        this.load();                    // refresh the call log
        if (navigator.vibrate) navigator.vibrate([8, 30, 8]);
      },
      error: () => {
        this.booking.set(false);
        this.bookErr.set('That slot was just taken. Pick another time.');
        this.freeDays.set([]);          // force a refresh of availability
        this.loadSlots();
      },
    });
  }

  /** Success-screen summary line. */
  get bookedSummary(): string {
    const s = this.chosenSlot();
    if (!s) return '';
    const ms = this.parseSlot(s.slot);
    return `${this.dateLabel(ms)}, ${this.timeLabel(ms)}`;
  }

  // ── date helpers ──
  private parseSlot(slot: string): number {
    const t = new Date(slot).getTime();
    return isNaN(t) ? 0 : t;
  }
  private dateLabel(ms: number): string {
    const d = new Date(ms);
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(ms); that.setHours(0, 0, 0, 0);
    const days = Math.round((that.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${wk[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`;
  }
  /** Compact day chip label for the picker rail: "Today", "Tomorrow", "Wed 10". */
  private dayChip(dateStr: string): string {
    const ms = new Date(dateStr + 'T00:00:00').getTime();
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(ms); that.setHours(0, 0, 0, 0);
    const days = Math.round((that.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    const d = new Date(ms);
    return `${wk[d.getDay()]} ${d.getDate()}`;
  }
  private timeLabel(ms: number): string {
    const d = new Date(ms);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }
}
