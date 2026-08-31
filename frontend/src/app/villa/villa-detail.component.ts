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
