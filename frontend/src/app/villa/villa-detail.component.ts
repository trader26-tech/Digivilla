import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
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
export class VillaDetailComponent implements OnInit, OnDestroy {
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
  /** Five punchy, number-led reasons an eVilla beats a real villa. Each card is
   *  ONE statement built around a big money/time figure, on its own themed
   *  background. `theme` selects the card's colour treatment in the SCSS. */
  readonly PERKS = [
    { theme: 'stamp', icon: '🧾', stat: '₹2.1L', unit: 'saved',   line: 'A real villa loses this to stamp duty & registration. An eVilla costs ₹0 to buy in.' },
    { theme: 'time',  icon: '⚡', stat: '30 sec', unit: 'to own', line: 'Own an eVilla in 30 seconds — a real villa takes 45+ days of paperwork.' },
    { theme: 'care',  icon: '🛠️', stat: '₹40k',  unit: 'a year', line: 'What a real villa eats in repairs. An eVilla costs you ₹0 — it’s fully hands-off.' },
    { theme: 'cash',  icon: '💸', stat: '2 days', unit: 'to exit', line: 'Cash out an eVilla in ~2 days. Selling a real villa drags on 6 months with brokers.' },
    { theme: 'entry', icon: '🚪', stat: '₹10L',  unit: 'to start', line: 'Start an eVilla from ₹10L — a real villa needs a ₹1Cr+ down-payment.' },
  ];
  perk = signal(0);
  private perkTimer?: ReturnType<typeof setInterval>;

  goPerk(i: number): void {
    this.perk.set((i + this.PERKS.length) % this.PERKS.length);
    this.startPerks();
  }
  /** Step one card forward/back — used by swipe. */
  stepPerk(dir: 1 | -1): void {
    this.goPerk(this.perk() + dir);
  }
  private startPerks(): void {
    this.stopPerks();
    this.perkTimer = setInterval(() => {
      this.perk.update((i) => (i + 1) % this.PERKS.length);
    }, 4200);
  }
  private stopPerks(): void {
    if (this.perkTimer) { clearInterval(this.perkTimer); this.perkTimer = undefined; }
  }

  // --- swipe/drag on the carousel (pointer events cover touch + mouse) ---
  private swipeX: number | null = null;

  onPerkDown(e: PointerEvent): void {
    this.swipeX = e.clientX;
    this.stopPerks();           // pause auto-advance while dragging
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
    } else {
      this.startPerks();                // not a swipe; resume auto-advance
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

    this.startPerks();
  }

  ngOnDestroy(): void {
    this.stopPerks();
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
