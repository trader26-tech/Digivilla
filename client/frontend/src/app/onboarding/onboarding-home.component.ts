import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { BookingService } from '../booking.service';

/**
 * The first thing a freshly-verified client sees, before they own any villa.
 *
 * Flow:
 *   1. A celebratory "verified" tick animation (only when we just came from OTP).
 *   2. The advantages of Digivilla at the top.
 *   3. A single, clear call to action: book a setup call with the fund manager.
 *      That call IS the account setup — the advisor asks the risk questions and
 *      then assigns the first villa, which is when the client's estate appears.
 *
 * The slot picker mirrors the withdraw flow (real free days from the advisor's
 * calendar, one tap to pick, one tap to confirm — a real booking).
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

  private auth = inject(AuthService);
  private bookingSvc = inject(BookingService);

  /** 'tick' plays the celebration; 'welcome' is the advantages + CTA screen. */
  phase = signal<'tick' | 'welcome'>('welcome');

  ADVANTAGES = [
    { ico: 'M4 13V4h9l7 7-9 9zM8 8h.01', title: 'Own from ₹10,000', sub: 'a fraction of a whole villa, not ₹1 Cr upfront' },
    { ico: 'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6', title: 'Monthly income', sub: 'your villa pays you every month, proportional to what’s in' },
    { ico: 'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z', title: 'Zero paperwork', sub: 'no stamp duty, no registration, no maintenance headaches' },
    { ico: 'M4 8h13l-3-3M20 16H7l3 3', title: 'Cash out in 2 days', sub: 'not 6 months of brokers — withdraw with one call' },
  ];

  ngOnInit(): void {
    if (this.justVerified) {
      this.phase.set('tick');
      // let the tick play, then reveal the welcome screen
      setTimeout(() => this.phase.set('welcome'), 1900);
    }
  }

  skipTick(): void { this.phase.set('welcome'); }

  // --- book the setup call: one-screen slot picker → real request ----------
  sheetOpen = signal(false);
  days = signal<{ iso: string; label: string; slots: { label: string; slot: string }[] }[]>([]);
  daysLoading = signal(false);
  slotIso = signal<string | null>(null);
  slotLabel = signal('');
  submitting = signal(false);
  error = signal('');
  booked = signal(false);
  justBooked = signal(false);

  openBooking(): void {
    this.booked.set(false);
    this.justBooked.set(false);
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
      next: () => {
        this.submitting.set(false);
        this.booked.set(true);
        this.justBooked.set(true);
        if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
        setTimeout(() => this.justBooked.set(false), 1600);
      },
      error: () => { this.submitting.set(false); this.error.set('Could not book that slot. Please try again.'); },
    });
  }
}
