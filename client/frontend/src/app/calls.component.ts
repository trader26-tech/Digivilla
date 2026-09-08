import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth/auth.service';
import { BookingService, Booking } from './booking.service';

/** A call, shaped for the list: parsed date/time + friendly labels. */
interface CallItem {
  booking: Booking;
  when: number;         // epoch ms of the slot (or created_at fallback)
  dateLabel: string;    // "Wed, 10 Sep"
  timeLabel: string;    // "10:30 am"
  status: string;       // requested | confirmed | declined
  meetLink: string;
  upcoming: boolean;
}

/**
 * Calls tab — the user's scheduled fund-manager calls. Consultation bookings
 * with a slot show here: upcoming ones first (with a Join button when the
 * advisor has attached a meeting link), then past calls.
 */
@Component({
  selector: 'app-calls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './calls.component.html',
  styleUrl: './calls.component.scss',
})
export class CallsComponent implements OnInit {
  private auth = inject(AuthService);
  private bookings = inject(BookingService);

  loading = signal(true);
  raw = signal<Booking[]>([]);

  ngOnInit(): void { this.load(); }

  load(): void {
    const phone = this.auth.user()?.phone || '';
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

  statusText(s: string): string {
    return s === 'confirmed' ? 'Confirmed' : s === 'declined' ? 'Declined' : 'Requested';
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
  private timeLabel(ms: number): string {
    const d = new Date(ms);
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }
}
