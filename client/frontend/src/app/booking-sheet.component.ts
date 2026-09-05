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

import { BookingService, RequestKind } from './booking.service';

interface DayOpt {
  iso: string;      // YYYY-MM-DD
  weekday: string;  // Mon
  day: number;      // 3
  month: string;    // Sep
}

/**
 * Bottom-sheet a user gets from a Digivilla. Depending on `kind` it either:
 *   consultation — pick a free time; we call to walk them through & complete it
 *   sip / buy / withdraw — a slot-less action request sent straight to the
 *      advisor's calendar (no time picker; just name + phone + amount).
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
  /** Which action this sheet performs. Defaults to consultation (Reserve). */
  @Input() kind: RequestKind = 'consultation';
  @Output() close = new EventEmitter<void>();

  private api = inject(BookingService);

  /** Copy that adapts to the request kind. */
  get isConsult(): boolean { return this.kind === 'consultation'; }
  get headTitle(): string {
    return {
      consultation: 'Reserve this Digivilla',
      sip: 'Start a monthly SIP',
      buy: 'Own this Digivilla',
      withdraw: 'Request a withdrawal',
    }[this.kind];
  }
  get doneTitle(): string {
    return {
      consultation: 'Consultation requested',
      sip: 'SIP request sent',
      buy: 'Purchase request sent',
      withdraw: 'Withdrawal request sent',
    }[this.kind];
  }
  get doneSub(): string {
    return this.isConsult
      ? "We'll call you at that time to walk you through it and complete the payment. You'll get a confirmation shortly."
      : "Your advisor has been notified and will call you shortly to complete it. You'll get a confirmation soon.";
  }
  get ctaLabel(): string {
    return {
      consultation: 'Request',
      sip: 'Request SIP',
      buy: 'Request to own',
      withdraw: 'Request withdrawal',
    }[this.kind];
  }
  get amountLabel(): string {
    return this.kind === 'sip' ? 'Monthly amount'
      : this.kind === 'withdraw' ? 'Amount to withdraw' : 'Amount';
  }

  name = signal('');
  phone = signal('');
  amountInput = signal<number>(0);    // editable for sip/buy/withdraw
  selectedDay = signal<string>('');   // YYYY-MM-DD
  selectedTime = signal<string>('');  // "15:00"

  days: DayOpt[] = [];
  readonly times = ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

  taken = signal<Set<string>>(new Set());
  submitting = signal(false);
  done = signal(false);
  error = signal('');

  ngOnInit(): void {
    this.amountInput.set(this.amount || 0);
    if (this.isConsult) {
      this.days = this.nextWeekdays(10);
      this.selectedDay.set(this.days[0]?.iso ?? '');
      this.api.takenSlots().subscribe({
        next: (r) => this.taken.set(new Set(r.slots)),
        error: () => {},
      });
    }
  }

  onAmount(v: string): void {
    const n = parseInt((v || '').replace(/\D/g, ''), 10);
    this.amountInput.set(isNaN(n) ? 0 : n);
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
    if (this.submitting()) return false;
    const baseOk = this.name().trim().length >= 2 && this.validPhone;
    if (!baseOk) return false;
    if (this.isConsult) return !!this.selectedDay() && !!this.selectedTime();
    // sip/buy/withdraw: need a positive amount
    return this.amountInput() > 0;
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

    const req$ = this.isConsult
      ? this.api.createBooking({
          name: this.name().trim(),
          phone: this.phone(),
          kind: 'consultation',
          property: this.property,
          variant: this.variant,
          plots: this.plots,
          amount: this.amountInput(),
          slot: this.slotIso(this.selectedDay(), this.selectedTime()),
        })
      : this.api.createRequest({
          name: this.name().trim(),
          phone: this.phone(),
          kind: this.kind,
          property: this.property,
          variant: this.variant,
          amount: this.amountInput(),
        });

    req$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.done.set(true);
        if (navigator.vibrate) navigator.vibrate([6, 40, 10]);
      },
      error: () => {
        this.submitting.set(false);
        this.error.set(this.isConsult
          ? 'Could not book that slot. Please try again.'
          : 'Could not send your request. Please try again.');
      },
    });
  }
}
