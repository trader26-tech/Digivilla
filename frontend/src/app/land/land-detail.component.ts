import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { compact, compactK, inr } from '../shared/format.util';
import {
  HoldingFund,
  VillaPlan,
  assetColor,
  assetLabel,
  currentValue,
  villaPlan,
} from '../villa/villa-detail.model';

/**
 * Land detail page — mirrors the villa page, minus rent. A pure-appreciation
 * plot, so instead of "total rent paid" the second figure is the CAGR, and
 * there is no rent section. Layout, styling and the withdraw flow are shared
 * with the villa page (same SCSS).
 *
 * Sections, in order:
 *   1. the land image (the exact map art), and nothing else
 *   2. current value (left) · CAGR (right)
 *   3. "Your e-land perks" carousel
 *   4. funds inside
 *   5. withdraw
 */
@Component({
  selector: 'app-land-page',
  standalone: true,
  imports: [CommonModule, LandArtComponent],
  templateUrl: './land-detail.component.html',
  styleUrl: '../villa/villa-detail.component.scss',
})
export class LandDetailComponent implements OnInit {
  /** Land price in rupees (the invested amount). */
  @Input() price = 30_00_000;
  /** Display name for the plot. */
  @Input() name = 'Growth Plot';
  /** When it was bought (epoch ms) — drives the growth curve. */
  @Input() boughtAt = Date.now();
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;

  /** Value figures. */
  current = 0;
  gain = 0;

  // --- withdraw: a 4-step "book a call with the fund manager" flow ---
  withdrawOpen = signal(false);
  wdStep = signal(0);
  wdMonth = signal(this.firstOfThisMonth());
  wdDay = signal<Date | null>(null);
  wdSlot = signal<string | null>(null);
  justBooked = signal(false);

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
  wdBegin(): void { this.wdStep.set(1); }

  get wdMonthLabel(): string {
    return this.wdMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  get wdCells(): (Date | null)[] {
    const m = this.wdMonth();
    const year = m.getFullYear();
    const mon = m.getMonth();
    const lead = new Date(year, mon, 1).getDay();
    const days = new Date(year, mon + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(year, mon, d));
    return cells;
  }
  get wdCanPrev(): boolean {
    return this.wdMonth() > this.firstOfThisMonth();
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
  wdPickSlot(slot: string): void {
    this.wdSlot.set(slot);
    this.wdStep.set(3);
    this.justBooked.set(true);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
    setTimeout(() => this.justBooked.set(false), 1600);
  }

  // --- "Land vs e-land" carousel (no rent card — land has no rent) ---
  PERKS: { theme: string; ico: string; stat: string; unit: string; vs: string }[] = [];

  private static readonly ICO: Record<string, string> = {
    tag:    'M4 13V4h9l7 7-9 9zM8 8h.01',
    chart:  'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:   'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:   'M13 3L5 13h5l-1 8 8-10h-5z',
    swap:   'M4 8h13l-3-3M20 16H7l3 3',
    door:   'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',
  };

  private buildPerks(): void {
    const stampSaved = compact(Math.round(this.price * 0.07));   // ~7% duty + registration
    const liveVal = compact(this.current);
    const I = LandDetailComponent.ICO;
    this.PERKS = [
      { theme: 'stamp', ico: I['tag'],   stat: stampSaved, unit: 'saved',       vs: 'in 7% stamp duty & registration' },
      { theme: 'live',  ico: I['chart'], stat: liveVal,    unit: 'live value',  vs: 'you can check any time' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',       unit: 'maintenance', vs: 'no fencing, no upkeep' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',   unit: 'to own',      vs: 'not 45 days of paperwork' },
      { theme: 'cash',  ico: I['swap'],  stat: '2 days',   unit: 'to cash out', vs: 'not 6+ months of brokers' },
      { theme: 'entry', ico: I['door'],  stat: '₹10L',     unit: 'to start',    vs: 'not a ₹1 Cr land deal' },
    ];
  }
  perk = signal(0);
  goPerk(i: number): void {
    this.perk.set((i + this.PERKS.length) % this.PERKS.length);
  }
  stepPerk(dir: 1 | -1): void {
    this.goPerk(this.perk() + dir);
  }

  private swipeX: number | null = null;
  onPerkDown(e: PointerEvent): void {
    this.swipeX = e.clientX;
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
      this.stepPerk(dx < 0 ? 1 : -1);
    }
  }

  // format helpers
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
    this.buildPerks();
  }

  onBack(): void {
    this.back.emit();
  }

  trackFund(_i: number, f: HoldingFund): string {
    return f.name;
  }
}
