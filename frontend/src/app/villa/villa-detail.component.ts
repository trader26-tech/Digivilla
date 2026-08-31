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

import { BookingSheetComponent } from '../booking-sheet.component';
import { compact, inr, pct } from '../shared/format.util';
import {
  HoldingFund,
  VillaPlan,
  assetColor,
  assetLabel,
  villaPlan,
} from './villa-detail.model';

/**
 * Standalone villa detail page. Opened when a villa is tapped or from a buy
 * flow. Shows the villa, what it costs, how the money grows over 20 years, the
 * rent it pays, a collapsible fund breakdown, and a CTA that opens booking.
 */
@Component({
  selector: 'app-villa-detail',
  standalone: true,
  imports: [CommonModule, BookingSheetComponent],
  templateUrl: './villa-detail.component.html',
  styleUrl: './villa-detail.component.scss',
})
export class VillaDetailComponent implements OnInit {
  /** Villa price in rupees. */
  @Input() price = 30_00_000;
  /** Display name for the villa. */
  @Input() name = 'Signature Villa';
  @Output() back = new EventEmitter<void>();

  // chart geometry (viewBox units)
  readonly CW = 320;
  readonly CH = 150;

  plan!: VillaPlan;

  /** Funds panel starts collapsed, as requested. */
  fundsOpen = signal(false);
  /** Booking sheet open state. */
  booking = signal(false);

  // format helpers for the template
  compact = compact;
  inr = inr;
  pct = pct;
  assetColor = assetColor;
  assetLabel = assetLabel;

  ngOnInit(): void {
    this.plan = villaPlan(this.price, 20);
  }

  toggleFunds(): void {
    this.fundsOpen.update((v) => !v);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  openBooking(): void {
    this.booking.set(true);
    if (navigator.vibrate) navigator.vibrate(5);
  }

  onBack(): void {
    this.back.emit();
  }

  // ---------------- growth chart ----------------

  private get vals(): number[] {
    return this.plan.growth.map((g) => g.value);
  }

  /** Smooth area + line path for the growth curve. */
  chartLine = computed(() => this.pathFor(false));
  chartArea = computed(() => this.pathFor(true));

  private pathFor(closed: boolean): string {
    const vals = this.vals;
    if (vals.length < 2) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const padT = 8;
    const padB = 8;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * this.CW;
      const y = padT + (1 - (v - min) / span) * (this.CH - padT - padB);
      return [x, y] as const;
    });
    const line = pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    if (!closed) return line;
    return `${line} L${this.CW},${this.CH} L0,${this.CH} Z`;
  }

  /** Year markers along the x-axis. */
  get xTicks(): { x: number; label: string }[] {
    const yrs = [0, 5, 10, 15, 20];
    return yrs.map((y) => ({
      x: (y / this.plan.years) * this.CW,
      label: y === 0 ? 'now' : `${y}y`,
    }));
  }

  get growthMultiple(): number {
    return this.plan.finalValue / this.plan.price;
  }

  trackFund(_i: number, f: HoldingFund): string {
    return f.name;
  }
}
