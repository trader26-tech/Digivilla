import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';

import { BookingService } from './booking.service';

interface DayOpt {
  iso: string;      // YYYY-MM-DD
  weekday: string;  // Mon
  day: number;      // 3
  month: string;    // Sep
}

/**
 * Bottom-sheet a user gets after tapping "Reserve" on a plot. They leave their
 * name + phone and pick a free time for a consultation call; we book it as a
 * `requested` slot the admin later confirms.
 */
@Component({
  selector: 'app-booking-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './booking-sheet.component.html',
  styleUrl: './booking-sheet.component.scss',
})
export class BookingSheetComponent implements OnInit {
  @Input() property = 'land';
  @Input() variant = '';
  @Input() variantName = '';
  @Input() plots = 1;
  @Input() amount = 0;
  @Output() close = new EventEmitter<void>();

  private api = inject(BookingService);

  name = signal('');
  phone = signal('');
  selectedDay = signal<string>('');   // YYYY-MM-DD
  selectedTime = signal<string>('');  // "15:00"

  days: DayOpt[] = [];
  readonly times = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

  taken = signal<Set<string>>(new Set());
  submitting = signal(false);
  done = signal(false);
  error = signal('');

  ngOnInit(): void {
    this.days = this.nextWeekdays(10);
    this.selectedDay.set(this.days[0]?.iso ?? '');
    this.api.takenSlots().subscribe({
      next: (r) => this.taken.set(new Set(r.slots)),
      error: () => {},
    });
  }

  /** The next `n` weekdays (skipping Sat/Sun), starting tomorrow. */
  private nextWeekdays(n: number): DayOpt[] {
    const out: DayOpt[] = [];
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (out.length < n) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        out.push({ iso, weekday: wk[dow], day: d.getDate(), month: mo[d.getMonth()] });
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /** ISO datetime (local, +05:30) for a day+time, matching what the backend stores. */
  private slotIso(day: string, time: string): string {
    return `${day}T${time}:00+05:30`;
  }

  isTaken(time: string): boolean {
    return this.taken().has(this.slotIso(this.selectedDay(), time));
  }
  pickTime(time: string): void {
    if (this.isTaken(time)) return;
    this.selectedTime.set(this.selectedTime() === time ? '' : time);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  get validPhone(): boolean {
    return /^\d{10}$/.test(this.phone().replace(/\D/g, ''));
  }
  get canSubmit(): boolean {
    return (
      this.name().trim().length >= 2 &&
      this.validPhone &&
      !!this.selectedDay() &&
      !!this.selectedTime() &&
      !this.submitting()
    );
  }

  onPhone(v: string): void {
    this.phone.set(v.replace(/\D/g, '').slice(0, 10));
  }

  timeLabel(t: string): string {
    const h = parseInt(t, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${ampm}`;
  }

  chosenLabel(): string {
    const d = this.days.find((x) => x.iso === this.selectedDay());
    if (!d || !this.selectedTime()) return '';
    return `${d.weekday}, ${d.day} ${d.month} · ${this.timeLabel(this.selectedTime())}`;
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.submitting.set(true);
    this.error.set('');
    this.api
      .createBooking({
        name: this.name().trim(),
        phone: this.phone(),
        property: this.property,
        variant: this.variant,
        plots: this.plots,
        amount: this.amount,
        slot: this.slotIso(this.selectedDay(), this.selectedTime()),
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.done.set(true);
          if (navigator.vibrate) navigator.vibrate([6, 40, 10]);
        },
        error: () => {
          this.submitting.set(false);
          this.error.set('Could not book that slot. Please try again.');
        },
      });
  }
}
