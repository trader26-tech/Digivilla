import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { compact, compactK } from '../shared/format.util';
import {
  HoldingFund,
  StackYear,
  VillaPlan,
  assetColor,
  stackedProjection,
  villaPlan,
} from '../villa/villa-detail.model';

/**
 * Villa BUY page — reached from Build a new asset → pick Villa. Shows the villa
 * image, name, the investment amount and monthly rent, a perks carousel, a
 * 20-year stacked chart (invested + growth + rent), the funds inside, and a
 * "Book now" flow that books a call to get started (same calendar UX as the
 * withdraw / fund-manager flows).
 */
@Component({
  selector: 'app-villa-buy',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './villa-buy.component.html',
  styleUrls: ['../villa/villa-detail.component.scss', './villa-buy.component.scss'],
})
export class VillaBuyComponent implements OnInit {
  /** Investment amount presets the user can pick. */
  readonly PRESETS = [10_00_000, 25_00_000, 50_00_000, 1_00_00_000];
  amount = signal(25_00_000);

  @Input() name = 'Signature Villa';
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;
  stack: StackYear[] = [];

  // format helpers
  compact = compact;
  compactK = compactK;
  assetColor = assetColor;

  ngOnInit(): void {
    this.recompute();
  }

  pickAmount(a: number): void {
    this.amount.set(a);
    this.recompute();
    if (navigator.vibrate) navigator.vibrate(4);
  }

  private recompute(): void {
    this.plan = villaPlan(this.amount(), 20);
    this.stack = stackedProjection(this.plan);
    this.buildPerks();
  }

  get finalTotal(): number {
    return this.stack.length ? this.stack[this.stack.length - 1].total : 0;
  }
  get multiple(): number {
    return this.amount() > 0 ? this.finalTotal / this.amount() : 0;
  }

  // ---- stacked chart geometry ----
  readonly CH = 150;
  /** Bars to show — every ~4th year keeps it readable (0,4,8,12,16,20). */
  get bars(): StackYear[] {
    return this.stack.filter((s) => s.year % 4 === 0);
  }
  get chartMax(): number {
    return Math.max(1, ...this.bars.map((b) => b.total));
  }
  h(v: number): number {
    return (v / this.chartMax) * this.CH;
  }

  // ---- funds (expandable) ----
  fundsOpen = signal(false);
  toggleFunds(): void {
    this.fundsOpen.update((v) => !v);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // ---- perks carousel ----
  PERKS: { theme: string; ico: string; stat: string; unit: string; vs: string }[] = [];
  private static readonly ICO: Record<string, string> = {
    tag:   'M4 13V4h9l7 7-9 9zM8 8h.01',
    coin:  'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6',
    chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:  'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:  'M13 3L5 13h5l-1 8 8-10h-5z',
    door:  'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',
  };
  private buildPerks(): void {
    const I = VillaBuyComponent.ICO;
    this.PERKS = [
      { theme: 'stamp', ico: I['tag'],   stat: compact(Math.round(this.amount() * 0.07)), unit: 'saved',      vs: 'in 7% stamp duty & registration' },
      { theme: 'rent',  ico: I['coin'],  stat: compact(this.plan.rentMonthly),            unit: 'rent',       vs: 'in your account monthly' },
      { theme: 'live',  ico: I['chart'], stat: compact(this.finalTotal),                  unit: 'in 20y',     vs: 'value + rent, growing daily' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',                                      unit: 'upkeep',     vs: 'no repairs, no maintenance' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',                                  unit: 'to own',     vs: 'not 45 days of paperwork' },
      { theme: 'entry', ico: I['door'],  stat: '₹10L',                                    unit: 'to start',   vs: 'not a ₹1 Cr down-payment' },
    ];
  }
  perk = signal(0);
  goPerk(i: number): void { this.perk.set((i + this.PERKS.length) % this.PERKS.length); }
  stepPerk(dir: 1 | -1): void { this.goPerk(this.perk() + dir); }
  private swipeX: number | null = null;
  onPerkDown(e: PointerEvent): void {
    this.swipeX = e.clientX;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }
  onPerkUp(e: PointerEvent): void {
    if (this.swipeX === null) return;
    const dx = e.clientX - this.swipeX;
    this.swipeX = null;
    if (Math.abs(dx) > 40) this.stepPerk(dx < 0 ? 1 : -1);
  }

  // ---- book now: pick a day → time → confirmed (same as the call flow) ----
  bookOpen = signal(false);
  bkStep = signal(1);
  bkMonth = signal(this.firstOfThisMonth());
  bkDay = signal<Date | null>(null);
  bkSlot = signal<string | null>(null);
  justBooked = signal(false);
  readonly SLOTS = ['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'];

  private firstOfThisMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  openBook(): void {
    this.bkStep.set(1);
    this.bkMonth.set(this.firstOfThisMonth());
    this.bkDay.set(null);
    this.bkSlot.set(null);
    this.justBooked.set(false);
    this.bookOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  closeBook(): void { this.bookOpen.set(false); }

  get bkMonthLabel(): string {
    return this.bkMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  get bkCells(): (Date | null)[] {
    const m = this.bkMonth();
    const y = m.getFullYear(), mon = m.getMonth();
    const lead = new Date(y, mon, 1).getDay();
    const days = new Date(y, mon + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(new Date(y, mon, d));
    return out;
  }
  get bkCanPrev(): boolean { return this.bkMonth() > this.firstOfThisMonth(); }
  bkPrev(): void {
    if (!this.bkCanPrev) return;
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  bkNext(): void {
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  bkSelectable(dt: Date): boolean {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) return false;
    const min = new Date(); min.setHours(0, 0, 0, 0); min.setDate(min.getDate() + 1);
    return dt.getTime() >= min.getTime();
  }
  bkIsDay(dt: Date): boolean {
    const d = this.bkDay();
    return !!d && d.getTime() === dt.getTime();
  }
  bkPickDay(dt: Date): void {
    if (!this.bkSelectable(dt)) return;
    this.bkDay.set(dt);
    this.bkSlot.set(null);
    this.bkStep.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  bkPickSlot(s: string): void {
    this.bkSlot.set(s);
    this.bkStep.set(3);
    this.justBooked.set(true);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
    setTimeout(() => this.justBooked.set(false), 1600);
  }

  onBack(): void { this.back.emit(); }
  trackFund(_i: number, f: HoldingFund): string { return f.name; }
  trackYear(_i: number, s: StackYear): number { return s.year; }
}
