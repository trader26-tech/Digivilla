import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';

import { compact, compactK } from '../shared/format.util';
import {
  HoldingFund,
  VillaPlan,
  assetColor,
  assetLabel,
  villaPlan,
} from '../villa/villa-detail.model';

/**
 * The under-construction detail page — a villa still being built. Mirrors the
 * villa page's shape (image · figures · funds · withdraw) but the numbers are
 * about the BUILD: how much is in, how much is left, when it completes, and
 * the rent it will pay once done. Self-contained; the withdraw flow books a
 * call with the fund manager, exactly like the villa page.
 */
@Component({
  selector: 'app-construction-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './construction-detail.component.html',
  styleUrl: './construction-detail.component.scss',
})
export class ConstructionDetailComponent implements OnInit {
  /** Target villa cost this build is working toward. */
  @Input() cost = 40_00_000;
  /** Monthly SIP feeding the build. */
  @Input() sipMonthly = 25_000;
  /** How much has accrued so far. */
  @Input() sipAccrued = 6_00_000;
  /** Display name, e.g. "Under Construction 1". */
  @Input() name = 'Under Construction';
  /** When the build was started (epoch ms). */
  @Input() boughtAt = Date.now();
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;

  // build figures
  investedSoFar = 0;
  monthsTotal = 0;
  monthsDone = 0;
  monthsLeft = 0;
  pct = 0;
  rentWhenBuilt = 0;
  completesOn = new Date();

  compact = compact;
  compactK = compactK;
  assetColor = assetColor;
  assetLabel = assetLabel;

  ngOnInit(): void {
    this.plan = villaPlan(this.cost, 20);

    this.investedSoFar = this.sipAccrued;
    this.monthsTotal = this.sipMonthly > 0 ? Math.round(this.cost / this.sipMonthly) : 60;
    this.monthsDone = this.sipMonthly > 0 ? Math.round(this.sipAccrued / this.sipMonthly) : 0;
    this.monthsDone = Math.min(this.monthsDone, this.monthsTotal);
    this.monthsLeft = Math.max(0, this.monthsTotal - this.monthsDone);
    this.pct = this.monthsTotal > 0 ? Math.round((this.monthsDone / this.monthsTotal) * 100) : 0;
    this.rentWhenBuilt = Math.round((this.cost * 0.06) / 12);   // ~6%/yr once built

    const d = new Date();
    d.setMonth(d.getMonth() + this.monthsLeft);
    this.completesOn = d;

    this.buildPerks();
  }

  onBack(): void {
    this.back.emit();
  }

  // --- "why this beats a real villa" carousel (swipe-only) ---
  PERKS: { theme: string; ico: string; stat: string; unit: string; vs: string }[] = [];
  perk = signal(0);

  private static readonly ICO: Record<string, string> = {
    tag:   'M4 13V4h9l7 7-9 9zM8 8h.01',
    coin:  'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6',
    chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:  'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:  'M13 3L5 13h5l-1 8 8-10h-5z',
    swap:  'M4 8h13l-3-3M20 16H7l3 3',
    door:  'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',
  };

  private buildPerks(): void {
    const I = ConstructionDetailComponent.ICO;
    const rent = compact(this.rentWhenBuilt);
    const stampSaved = compact(Math.round(this.cost * 0.07));
    this.PERKS = [
      { theme: 'rent',  ico: I['coin'],  stat: rent,       unit: 'rent soon', vs: 'starts the day it completes' },
      { theme: 'stamp', ico: I['tag'],   stat: stampSaved, unit: 'saved',     vs: 'in 7% stamp duty & registration' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',       unit: 'maintenance', vs: 'no repairs, no upkeep' },
      { theme: 'live',  ico: I['chart'], stat: 'Live',     unit: 'progress',  vs: 'track the build any time' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',   unit: 'to own',    vs: 'not 45 days of paperwork' },
      { theme: 'cash',  ico: I['swap'],  stat: '2 days',   unit: 'to cash out', vs: 'not 6+ months of brokers' },
      { theme: 'entry', ico: I['door'],  stat: '₹10L',    unit: 'to start',  vs: 'not a ₹1 Cr down-payment' },
    ];
  }

  goPerk(i: number): void { this.perk.set((i + this.PERKS.length) % this.PERKS.length); }
  stepPerk(dir: 1 | -1): void { this.goPerk(this.perk() + dir); }

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
    if (Math.abs(dx) > 40) this.stepPerk(dx < 0 ? 1 : -1);
  }

  trackFund(_i: number, f: HoldingFund): string {
    return f.name;
  }

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
  closeWithdraw(): void { this.withdrawOpen.set(false); }
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
  get wdCanPrev(): boolean { return this.wdMonth() > this.firstOfThisMonth(); }
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
}
