import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { Booking, BookingService } from '../booking.service';

/**
 * The first thing a freshly-verified client sees, before they own any villa.
 *
 * Flow:
 *   1. A celebratory "verified" tick animation (only when we just came from OTP).
 *   2. The advantages of Digivilla + a single CTA: book a setup call.
 *   3. Once a call is booked, this becomes the home screen: a "coming soon"
 *      villa, the booked call's date/time + status, and what happens on the
 *      call. It stays until the advisor assigns the first villa (which flips the
 *      whole app to the single-house view).
 *
 * The setup call is a REAL booking in the shared DB; the booked state is read
 * back from the DB (by phone) so it persists across reopens.
 */
@Component({
  selector: 'app-onboarding-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './onboarding-home.component.html',
  styleUrl: './onboarding-home.component.scss',
})
export class OnboardingHomeComponent implements OnInit {
  /** Show the big verified-tick celebration first (set right after OTP). */
  @Input() justVerified = false;
  /** Embedded in the unified home shell → drop the outer page padding. */
  @Input() embedded = false;
  /** Fires when we want the shell to re-sync the estate (advisor may have
   *  assigned a villa). Lets the home refresh without a manual reload. */
  @Output() refresh = new EventEmitter<void>();

  private auth = inject(AuthService);
  private bookingSvc = inject(BookingService);

  /** 'tick' plays the celebration; 'welcome' is the advantages + CTA screen;
   *  'booked' is the home shown once the setup call is booked. */
  phase = signal<'tick' | 'welcome' | 'booked'>('welcome');

  /** The upcoming setup call, read from the DB (or set right after booking). */
  upcoming = signal<Booking | null>(null);

  /** What the advisor does on the call — shown on the booked home. */
  STEPS = [
    { n: 1, title: 'Understand your goals', sub: 'a few quick risk & timeline questions' },
    { n: 2, title: 'Assign your first villa', sub: 'the right basket for you, set up live' },
    { n: 3, title: 'Start your first payment', sub: 'your villa begins building right away' },
  ];

  ADVANTAGES = [
    { ico: 'M4 13V4h9l7 7-9 9zM8 8h.01', title: 'Own from ₹10,000', sub: 'a fraction of a whole villa, not ₹1 Cr upfront' },
    { ico: 'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6', title: 'Monthly income', sub: 'your villa pays you every month, proportional to what’s in' },
    { ico: 'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z', title: 'Zero paperwork', sub: 'no stamp duty, no registration, no maintenance headaches' },
    { ico: 'M4 8h13l-3-3M20 16H7l3 3', title: 'Cash out in 2 days', sub: 'not 6 months of brokers — withdraw with one call' },
  ];

  ngOnInit(): void {
    // If the user already booked a setup call (this or an earlier session),
    // land straight on the booked home. Otherwise show advantages + CTA.
    this.loadUpcoming(true);
    if (this.justVerified) {
      this.phase.set('tick');
      // let the tick play, then reveal the right screen (booked or welcome)
      setTimeout(() => { if (this.phase() === 'tick') this.settleAfterTick(); }, 1900);
    }
  }

  skipTick(): void { this.settleAfterTick(); }
  private settleAfterTick(): void {
    this.phase.set(this.upcoming() ? 'booked' : 'welcome');
  }

  /** Load this client's most recent upcoming consultation from the DB. */
  private loadUpcoming(settlePhase = false): void {
    const phone = this.auth.user()?.phone || '';
    if (!phone) return;
    this.bookingSvc.mine(phone).subscribe({
      next: (list) => {
        const now = Date.now();
        const next = (list || [])
          .filter((b) => b.kind === 'consultation' && b.status !== 'declined' && b.slot)
          .filter((b) => new Date(b.slot!).getTime() > now - 3 * 3600_000)  // keep recent/future
          .sort((a, b) => new Date(a.slot!).getTime() - new Date(b.slot!).getTime())[0] || null;
        this.upcoming.set(next);
        // only auto-switch to 'booked' outside the tick; the tick settles itself
        if (settlePhase && !this.justVerified && next) this.phase.set('booked');
      },
      error: () => {},
    });
  }

  /** Pretty date/time for the booked card, from the slot ISO. */
  get callWhen(): { day: string; time: string } | null {
    const iso = this.upcoming()?.slot;
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const wk = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const h = d.getHours(), m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return {
      day: `${wk[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`,
      time: m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`,
    };
  }

  /** True once the advisor has confirmed the call (vs still 'requested'). */
  get isConfirmed(): boolean { return this.upcoming()?.status === 'confirmed'; }

  /** Re-check the DB (advisor may have confirmed, or assigned a villa). */
  recheck(): void {
    this.loadUpcoming();
    this.refresh.emit();
  }

  // --- book the setup call: one-screen slot picker → real request ----------
  sheetOpen = signal(false);
  days = signal<{ iso: string; label: string; slots: { label: string; slot: string }[] }[]>([]);
  daysLoading = signal(false);
  slotIso = signal<string | null>(null);
  slotLabel = signal('');
  submitting = signal(false);
  error = signal('');

  openBooking(): void {
    this.slotIso.set(null); this.slotLabel.set(''); this.error.set('');
    this.sheetOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
    this.loadDays();
  }
  closeBooking(): void { this.sheetOpen.set(false); }

  private loadDays(): void {
    this.daysLoading.set(true);
    this.days.set([]);
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.bookingSvc.freeDays(4).subscribe({
      next: (r) => {
        this.days.set((r.days || []).map((day) => {
          const [y, m, d] = day.date.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          return {
            iso: day.date,
            label: `${wk[dt.getDay()]}, ${dt.getDate()} ${mo[dt.getMonth()]}`,
            slots: (day.slots || []).map((s) => ({ label: this.slotLabelFor(s.time), slot: s.slot })),
          };
        }));
        this.daysLoading.set(false);
      },
      error: () => { this.days.set([]); this.daysLoading.set(false); },
    });
  }
  private slotLabelFor(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }
  pick(dayLabel: string, s: { label: string; slot: string }): void {
    this.slotIso.set(s.slot);
    this.slotLabel.set(`${dayLabel} · ${s.label}`);
    this.error.set('');
    if (navigator.vibrate) navigator.vibrate(4);
  }
  isSlot(s: { slot: string }): boolean { return this.slotIso() === s.slot; }

  confirm(): void {
    if (this.submitting() || !this.slotIso()) return;
    const u = this.auth.user();
    const name = (u?.name || '').trim() || 'New client';
    const phone = (u?.phone || '').replace(/\D/g, '').slice(-10);
    this.submitting.set(true);
    this.error.set('');
    this.bookingSvc.createBooking({
      name, phone,
      kind: 'consultation',
      property: 'villa',
      variant: 'balanced',
      slot: this.slotIso()!,
      note: 'Account setup · risk profile & first villa',
    }).subscribe({
      next: (b) => {
        this.submitting.set(false);
        this.upcoming.set(b);            // show it immediately on the booked home
        if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
        // close the sheet and land on the booked home screen
        this.sheetOpen.set(false);
        this.phase.set('booked');
        // reconcile with the DB (canonical record) shortly after
        setTimeout(() => this.loadUpcoming(), 400);
      },
      error: () => { this.submitting.set(false); this.error.set('Could not book that slot. Please try again.'); },
    });
  }
}
