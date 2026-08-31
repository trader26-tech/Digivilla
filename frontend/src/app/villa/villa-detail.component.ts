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

  // --- "Villa vs eVilla" carousel ---
  /** Each card: eVilla’s win as a big number, plus ONE line (5–6 words) naming
   *  the real-villa cost. Built in ngOnInit so the rent and stamp-duty figures
   *  are the villa’s real numbers. */
  PERKS: { theme: string; icon: string; stat: string; unit: string; vs: string }[] = [];

  private buildPerks(): void {
    const stampSaved = compact(Math.round(this.price * 0.07));   // ~7% duty + registration
    const rent = compact(this.plan.rentMonthly);
    const liveVal = compact(this.current);                       // today's value, updates daily
    this.PERKS = [
      { theme: 'stamp', icon: '🧾', stat: stampSaved, unit: 'saved',       vs: '7% stamp duty & registration' },
      { theme: 'rent',  icon: '💰', stat: rent,       unit: 'a month',     vs: 'Paid to you, hands-off' },
      { theme: 'live',  icon: '📈', stat: liveVal,    unit: 'live value',  vs: 'Updates daily, not a valuer' },
      { theme: 'care',  icon: '🛠️', stat: '₹0',       unit: 'upkeep',      vs: 'Zero repairs, ever' },
      { theme: 'time',  icon: '⚡', stat: '30 sec',   unit: 'to own',      vs: 'Not 45 days of paperwork' },
      { theme: 'cash',  icon: '💸', stat: '2 days',   unit: 'to cash out', vs: 'Not 6+ months of brokers' },
      { theme: 'entry', icon: '🚪', stat: '₹10L',    unit: 'to start',    vs: 'Not a ₹1 Cr down-payment' },
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

  onBack(): void {
    this.back.emit();
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
