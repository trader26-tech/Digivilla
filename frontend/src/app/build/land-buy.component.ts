import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { compact, compactK } from '../shared/format.util';
import {
  HoldingFund,
  StackYear,
  VillaPlan,
  assetColor,
  villaPlan,
} from '../villa/villa-detail.model';

/**
 * Land BUY page — reached from Build a new asset → pick Land. Mirrors the villa
 * buy page but for a pure-growth plot: no rent, so the second figure is the
 * CAGR and the 20-year chart stacks invested + growth only.
 */
@Component({
  selector: 'app-land-buy',
  standalone: true,
  imports: [CommonModule, LandArtComponent],
  templateUrl: './land-buy.component.html',
  styleUrls: ['../villa/villa-detail.component.scss', './villa-buy.component.scss'],
})
export class LandBuyComponent implements OnInit {
  readonly PRESETS = [10_00_000, 25_00_000, 50_00_000, 1_00_00_000];
  amount = signal(25_00_000);

  @Input() name = 'Growth Plot';
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;
  stack: StackYear[] = [];

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
    // land has no rent — stack invested + growth only
    this.stack = this.plan.growth.map((g) => {
      const growth = Math.max(0, g.value - this.amount());
      return { year: g.year, invested: this.amount(), growth, rent: 0, total: this.amount() + growth };
    });
    this.buildPerks();
  }

  get finalTotal(): number {
    return this.stack.length ? this.stack[this.stack.length - 1].total : 0;
  }
  get multiple(): number {
    return this.amount() > 0 ? this.finalTotal / this.amount() : 0;
  }

  // ---- stacked chart ----
  get bars(): StackYear[] {
    return this.stack.filter((s) => s.year % 4 === 0);
  }
  get chartMax(): number {
    return Math.max(1, ...this.bars.map((b) => b.total));
  }

  // ---- funds (expandable) ----
  fundsOpen = signal(false);
  toggleFunds(): void {
    this.fundsOpen.update((v) => !v);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // ---- perks carousel (no rent card) ----
  PERKS: { theme: string; ico: string; stat: string; unit: string; vs: string }[] = [];
  private static readonly ICO: Record<string, string> = {
    tag:   'M4 13V4h9l7 7-9 9zM8 8h.01',
    chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:  'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:  'M13 3L5 13h5l-1 8 8-10h-5z',
    door:  'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',
  };
  private buildPerks(): void {
    const I = LandBuyComponent.ICO;
    this.PERKS = [
      { theme: 'stamp', ico: I['tag'],   stat: compact(Math.round(this.amount() * 0.07)), unit: 'saved',     vs: 'in 7% stamp duty & registration' },
      { theme: 'live',  ico: I['chart'], stat: compact(this.finalTotal),                  unit: 'in 20y',    vs: 'pure appreciation, growing daily' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',                                      unit: 'upkeep',    vs: 'no fencing, no maintenance' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',                                  unit: 'to own',    vs: 'not 45 days of paperwork' },
      { theme: 'entry', ico: I['door'],  stat: '₹10L',                                    unit: 'to start',  vs: 'not a ₹1 Cr land deal' },
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

  // ---- book now ----
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
