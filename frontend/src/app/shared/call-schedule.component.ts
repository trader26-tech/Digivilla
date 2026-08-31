import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { CallsService } from './calls.service';

/**
 * The fund-manager call button (top-right of the home screen) and its sheet.
 *
 * Tapping the button opens a sheet where the user can see upcoming scheduled
 * calls or book a new one (pick a day, then a time). If any call falls within
 * the next 24 hours, the button shows an alert star so the user is reminded.
 *
 * Fully self-contained: its own button, sheet and calendar. State lives in the
 * shared CallsService so bookings persist and other screens can read them.
 */
@Component({
  selector: 'app-call-schedule',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './call-schedule.component.html',
  styleUrl: './call-schedule.component.scss',
})
export class CallScheduleComponent {
  readonly svc = inject(CallsService);

  open = signal(false);
  /** 0 = list/overview · 1 = pick day · 2 = pick time · 3 = booked. */
  step = signal(0);
  month = signal(this.firstOfThisMonth());
  day = signal<Date | null>(null);
  slot = signal<string | null>(null);
  justBooked = signal(false);

  readonly SLOTS = ['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'];

  private firstOfThisMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  openSheet(): void {
    // land on the booking calendar if there's nothing scheduled yet, else the list
    this.step.set(this.svc.upcoming().length ? 0 : 1);
    this.month.set(this.firstOfThisMonth());
    this.day.set(null);
    this.slot.set(null);
    this.justBooked.set(false);
    this.open.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  close(): void {
    this.open.set(false);
  }
  startBooking(): void {
    this.step.set(1);
  }

  // -- calendar --
  get monthLabel(): string {
    return this.month().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  get cells(): (Date | null)[] {
    const m = this.month();
    const year = m.getFullYear();
    const mon = m.getMonth();
    const lead = new Date(year, mon, 1).getDay();
    const days = new Date(year, mon + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(new Date(year, mon, d));
    return out;
  }
  get canPrev(): boolean {
    return this.month() > this.firstOfThisMonth();
  }
  prevMonth(): void {
    if (!this.canPrev) return;
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  nextMonth(): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  /** Bookable if it's a weekday and at least 1 day out. */
  selectable(dt: Date): boolean {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) return false;
    const min = new Date();
    min.setHours(0, 0, 0, 0);
    min.setDate(min.getDate() + 1);
    return dt.getTime() >= min.getTime();
  }
  isDay(dt: Date): boolean {
    const d = this.day();
    return !!d && d.getTime() === dt.getTime();
  }
  pickDay(dt: Date): void {
    if (!this.selectable(dt)) return;
    this.day.set(dt);
    this.slot.set(null);
    this.step.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  pickSlot(slot: string): void {
    const d = this.day();
    if (!d) return;
    this.slot.set(slot);
    // combine the chosen day + time into a real datetime and persist it
    const at = this.combine(d, slot);
    this.svc.book(at, 'Portfolio review');
    this.step.set(3);
    this.justBooked.set(true);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
    setTimeout(() => this.justBooked.set(false), 1600);
  }

  /** Merge a date and a "2:00 PM" style slot into one Date. */
  private combine(day: Date, slot: string): Date {
    const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
    let h = 10;
    let min = 0;
    if (m) {
      h = parseInt(m[1], 10) % 12;
      min = parseInt(m[2], 10);
      if (/pm/i.test(m[3])) h += 12;
    }
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min);
  }

  /** Whole hours/days from now to a call, as a friendly "in …" label. */
  countdown(at: string): string {
    const ms = new Date(at).getTime() - Date.now();
    if (ms <= 0) return 'now';
    const hrs = Math.round(ms / 3_600_000);
    if (hrs < 24) return hrs <= 1 ? 'in 1 hour' : `in ${hrs} hours`;
    const days = Math.round(hrs / 24);
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }

  cancel(id: string): void {
    this.svc.cancel(id);
    if (navigator.vibrate) navigator.vibrate(4);
    if (!this.svc.upcoming().length) this.step.set(1);   // nothing left → offer to book
  }

  trackCall(_i: number, c: { id: string }): string {
    return c.id;
  }
}
