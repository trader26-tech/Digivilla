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
  imports: [CommonModule, VillaArtComponent],
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

  /** Funds section starts closed; opens on tap to reveal name + %. */
  fundsOpen = signal(false);

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
    this.plan = villaPlan(this.price, 20);
    this.current = currentValue(this.price, this.plan.cagr, this.boughtAt, now);
    this.gain = this.current - this.price;
    this.gainPct = this.price > 0 ? (this.gain / this.price) * 100 : 0;

    const sched = rentSchedule(this.boughtAt, this.plan.rentMonthly, now);
    this.next = sched.next;
    this.history = sched.paid;

    this.buildPerks();
  }

  openHistory(): void {
    this.historyOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeHistory(): void {
    this.historyOpen.set(false);
  }

  toggleFunds(): void {
    this.fundsOpen.update((v) => !v);
    if (navigator.vibrate) navigator.vibrate(4);
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
