import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AdminService, Booking } from './admin.service';

interface DayGroup {
  iso: string;       // YYYY-MM-DD
  label: string;     // "Tue, 3 Sep"
  isToday: boolean;
  slots: SlotCell[];
}
interface SlotCell {
  time: string;      // "15:00"
  label: string;     // "3 pm"
  booking: Booking | null;
}

const HOURS = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  private api = inject(AdminService);

  loggedIn = signal(false);

  // login form
  username = signal('');
  password = signal('');
  loginError = signal('');
  loggingIn = signal(false);

  // data
  bookings = signal<Booking[]>([]);
  loading = signal(false);
  loadError = signal('');
  busyId = signal<string>('');

  ngOnInit(): void {
    if (this.api.isLoggedIn) {
      this.loggedIn.set(true);
      this.refresh();
    }
  }

  // ---------- auth ----------
  doLogin(): void {
    if (!this.username().trim() || !this.password() || this.loggingIn()) return;
    this.loggingIn.set(true);
    this.loginError.set('');
    this.api.login(this.username().trim(), this.password()).subscribe({
      next: (r) => {
        this.api.saveToken(r.token);
        this.loggingIn.set(false);
        this.loggedIn.set(true);
        this.password.set('');
        this.refresh();
      },
      error: () => {
        this.loggingIn.set(false);
        this.loginError.set('Wrong username or password.');
      },
    });
  }
  logout(): void {
    this.api.logout();
    this.loggedIn.set(false);
    this.bookings.set([]);
  }

  // ---------- data ----------
  refresh(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api.listBookings().subscribe({
      next: (b) => {
        this.bookings.set(b);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        if (e?.status === 401) {
          this.logout();
        } else {
          this.loadError.set('Could not load bookings.');
        }
      },
    });
  }

  confirm(b: Booking): void {
    this.update(b, 'confirmed');
  }
  decline(b: Booking): void {
    this.update(b, 'declined');
  }
  reopen(b: Booking): void {
    this.update(b, 'requested');
  }
  private update(b: Booking, status: 'confirmed' | 'declined' | 'requested'): void {
    this.busyId.set(b.id);
    this.api.setStatus(b.id, status).subscribe({
      next: (updated) => {
        this.bookings.update((list) => list.map((x) => (x.id === b.id ? updated : x)));
        this.busyId.set('');
      },
      error: () => this.busyId.set(''),
    });
  }

  // ---------- stats ----------
  get requestedCount(): number {
    return this.bookings().filter((b) => b.status === 'requested').length;
  }
  get confirmedCount(): number {
    return this.bookings().filter((b) => b.status === 'confirmed').length;
  }

  // ---------- calendar grouping ----------
  /** Bookings grouped by day, each day showing every hour slot (10–6) with the
   *  booking that requested it, if any. Only days that have at least one
   *  booking are shown, chronologically. */
  days = computed<DayGroup[]>(() => {
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const todayIso = this.isoOf(new Date());

    // map day -> time -> booking
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
      const cells: SlotCell[] = HOURS.map((t) => ({
        time: t,
        label: this.timeLabel(t),
        booking: byDay.get(iso)!.get(t) ?? null,
      }));
      out.push({
        iso,
        label: d ? `${wk[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}` : iso,
        isToday: iso === todayIso,
        slots: cells,
      });
    }
    return out;
  });

  // ---------- helpers ----------
  private isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  private parseIso(iso: string): Date | null {
    const p = iso.split('-').map(Number);
    if (p.length !== 3) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  /** "2026-09-03T15:00:00+05:30" -> { day:'2026-09-03', time:'15:00' } */
  private splitSlot(slot: string): { day: string; time: string } {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(slot || '');
    return m ? { day: m[1], time: m[2] } : { day: '', time: '' };
  }
  timeLabel(t: string): string {
    const h = parseInt(t, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${ampm}`;
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
