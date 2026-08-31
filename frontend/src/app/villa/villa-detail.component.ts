import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  signal,
} from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact, compactK, inr } from '../shared/format.util';
import {
  HoldingFund,
  RentPayment,
  VillaPlan,
  assetColor,
  assetLabel,
  currentValue,
  rentSchedule,
  villaPlan,
} from './villa-detail.model';

/**
 * Villa detail page. Four components, in order:
 *   1. the villa image (the exact map art), and nothing else
 *   2. current value (left) vs invested + ₹ gain (right)
 *   3. rental income — the next payment, with a history sheet behind a control
 *   4. the funds this villa holds
 */
@Component({
  selector: 'app-villa-detail',
  standalone: true,
  imports: [CommonModule, VillaArtComponent, MfDisclaimerComponent],
  templateUrl: './villa-detail.component.html',
  styleUrl: './villa-detail.component.scss',
})
export class VillaDetailComponent implements OnInit {
  /** Villa price in rupees (the invested amount). */
  @Input() price = 30_00_000;
  /** Display name for the villa. */
  @Input() name = 'Signature Villa';
  /** When the villa was bought (epoch ms) — drives the rent schedule + growth. */
  @Input() boughtAt = Date.now();
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;

  /** Value figures. */
  current = 0;
  gain = 0;
  gainPct = 0;

  /** Rent schedule. */
  next!: RentPayment;
  history: RentPayment[] = [];
  historyOpen = signal(false);

  // --- withdraw: a 4-step "book a call with the fund manager" flow ---
  /** Withdraw sheet open? */
  withdrawOpen = signal(false);
  /** Which step of the flow: 0 intro · 1 pick date · 2 pick time · 3 booked. */
  wdStep = signal(0);
  /** The month the calendar is showing (1st of month). */
  wdMonth = signal(this.firstOfThisMonth());
  /** The day the user picked, or null. */
  wdDay = signal<Date | null>(null);
  /** The time slot the user picked, or null. */
  wdSlot = signal<string | null>(null);
  /** True briefly after booking, to run the tick-mark confirm animation. */
  justBooked = signal(false);

  /** Time slots the fund manager offers on a chosen day. */
  readonly WD_SLOTS = ['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'];

  private firstOfThisMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  openWithdraw(): void {
    this.wdStep.set(0);
    this.wdMonth.set(this.firstOfThisMonth());
    this.wdDay.set(null);
    this.wdSlot.set(null);
    this.justBooked.set(false);
    this.withdrawOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeWithdraw(): void {
    this.withdrawOpen.set(false);
  }

  /** Move from the intro to the date picker. */
  wdBegin(): void { this.wdStep.set(1); }

  // -- calendar --
  /** Label for the month being shown, e.g. "October 2026". */
  get wdMonthLabel(): string {
    return this.wdMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  /** The cells of the month grid: leading blanks (null) then each day's Date. */
  get wdCells(): (Date | null)[] {
    const m = this.wdMonth();
    const year = m.getFullYear();
    const mon = m.getMonth();
    const lead = new Date(year, mon, 1).getDay();          // 0=Sun blanks before day 1
    const days = new Date(year, mon + 1, 0).getDate();     // last date of month
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(year, mon, d));
    return cells;
  }
  /** Can't page earlier than the current month. */
  get wdCanPrev(): boolean {
    const now = this.firstOfThisMonth();
    return this.wdMonth() > now;
  }
  wdPrevMonth(): void {
    if (!this.wdCanPrev) return;
    const m = this.wdMonth();
    this.wdMonth.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  wdNextMonth(): void {
    const m = this.wdMonth();
    this.wdMonth.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  /** A day is bookable only if it's a weekday and at least 2 days out. */
  wdSelectable(dt: Date): boolean {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) return false;
    const min = new Date();
    min.setHours(0, 0, 0, 0);
    min.setDate(min.getDate() + 2);
    return dt.getTime() >= min.getTime();
  }
  wdIsDay(dt: Date): boolean {
    const d = this.wdDay();
    return !!d && d.getTime() === dt.getTime();
  }
  wdPickDay(dt: Date): void {
    if (!this.wdSelectable(dt)) return;
    this.wdDay.set(dt);
    this.wdSlot.set(null);
    this.wdStep.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // -- time slot --
  wdPickSlot(slot: string): void {
    this.wdSlot.set(slot);
    this.wdStep.set(3);
    this.justBooked.set(true);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
    setTimeout(() => this.justBooked.set(false), 1600);
  }

  // --- "Villa vs eVilla" carousel ---
  /** Each card: eVilla’s win as a big number, plus ONE line (5–6 words) naming
   *  the real-villa cost. Built in ngOnInit so the rent and stamp-duty figures
   *  are the villa’s real numbers. */
  PERKS: { theme: string; ico: string; stat: string; unit: string; vs: string }[] = [];

  /** Simple line-icons (24×24 viewBox path data) drawn in each card's accent
   *  colour, so the watermark always matches the number. */
  private static readonly ICO: Record<string, string> = {
    tag:    'M4 13V4h9l7 7-9 9zM8 8h.01',                                   // stamp/fees
    coin:   'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6',                          // rent
    chart:  'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',                     // live value
    tool:   'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',    // upkeep
    bolt:   'M13 3L5 13h5l-1 8 8-10h-5z',                                    // fast to own
    swap:   'M4 8h13l-3-3M20 16H7l3 3',                                      // cash out
    door:   'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',            // entry
  };

  private buildPerks(): void {
    const stampSaved = compact(Math.round(this.price * 0.07));   // ~7% duty + registration
    const rent = compact(this.plan.rentMonthly);
    const liveVal = compact(this.current);                       // today's value, updates daily
    const I = VillaDetailComponent.ICO;
    this.PERKS = [
      { theme: 'stamp', ico: I['tag'],   stat: stampSaved, unit: 'saved',       vs: 'in 7% stamp duty & registration' },
      { theme: 'rent',  ico: I['coin'],  stat: rent,       unit: 'rent',        vs: 'in your account monthly' },
      { theme: 'live',  ico: I['chart'], stat: liveVal,    unit: 'live value',  vs: 'you can check any time' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',       unit: 'maintenance', vs: 'no repairs, no upkeep' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',   unit: 'to own',      vs: 'not 45 days of paperwork' },
      { theme: 'cash',  ico: I['swap'],  stat: '2 days',   unit: 'to cash out', vs: 'not 6+ months of brokers' },
      { theme: 'entry', ico: I['door'],  stat: '₹10L',    unit: 'to start',    vs: 'not a ₹1 Cr down-payment' },
    ];
  }
  perk = signal(0);

  /** Jump to a card (dot tap), clamped-wrapped to a valid index. */
  goPerk(i: number): void {
    this.perk.set((i + this.PERKS.length) % this.PERKS.length);
  }
  /** Step one card forward/back — used by swipe. */
  stepPerk(dir: 1 | -1): void {
    this.goPerk(this.perk() + dir);
  }

  // --- swipe/drag on the carousel (pointer events cover touch + mouse) ---
  private swipeX: number | null = null;

  onPerkDown(e: PointerEvent): void {
    this.swipeX = e.clientX;
    // capture so pointermove/up keep coming to this element even as the finger
    // travels off the card it started on
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch {}
  }
  onPerkUp(e: PointerEvent): void {
    if (this.swipeX === null) return;
    const dx = e.clientX - this.swipeX;
    this.swipeX = null;
    const el = e.currentTarget as HTMLElement;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (Math.abs(dx) > 40) {
      this.stepPerk(dx < 0 ? 1 : -1);   // drag left → next, right → prev
    }
  }

  // format helpers for the template
  compact = compact;
  compactK = compactK;
  inr = inr;
  assetColor = assetColor;
  assetLabel = assetLabel;

  ngOnInit(): void {
    const now = new Date();
    // Guard the growth/rent math against a bad purchase date (0, missing, or in
    // the future). Compounding from epoch 0 (1970) once produced absurd values
    // like "₹98 Cr". Clamp to a sensible window so nothing ever blows up.
    const bought = this.safeBoughtAt(now.getTime());

    this.plan = villaPlan(this.price, 20);
    this.current = currentValue(this.price, this.plan.cagr, bought, now);
    this.gain = this.current - this.price;
    this.gainPct = this.price > 0 ? (this.gain / this.price) * 100 : 0;

    const sched = rentSchedule(bought, this.plan.rentMonthly, now);
    this.next = sched.next;
    this.history = sched.paid;

    this.buildPerks();
  }

  /** A safe purchase timestamp: never before 5 years ago, never in the future.
   *  Anything outside that (0, NaN, garbage) falls back to ~6 months ago. */
  private safeBoughtAt(nowMs: number): number {
    const FIVE_YEARS = 5 * 365 * 86_400_000;
    const min = nowMs - FIVE_YEARS;
    const b = this.boughtAt;
    if (!b || !Number.isFinite(b) || b < min || b > nowMs) {
      return nowMs - 182 * 86_400_000; // ~6 months ago
    }
    return b;
  }

  openHistory(): void {
    this.historyOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeHistory(): void {
    this.historyOpen.set(false);
  }

  onBack(): void {
    this.back.emit();
  }

  /** Whole days from today until the next rent payment (never negative). */
  get daysToNext(): number {
    const ms = this.next.date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }

  /** Total rent received so far, for the history sheet header. */
  get totalPaid(): number {
    return this.history.reduce((s, p) => s + p.amount, 0);
  }

  trackFund(_i: number, f: HoldingFund): string {
    return f.name;
  }
  trackPay(_i: number, p: RentPayment): number {
    return p.date.getTime();
  }
}
