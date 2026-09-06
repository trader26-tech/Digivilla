import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';

import { BookingService } from '../booking.service';
import { AuthService } from '../auth/auth.service';
import { VillaArtComponent } from '../shared/villa-art.component';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { MfdDisclosureComponent } from '../shared/mfd-disclosure.component';
import { LandDetailService, VillaBacktest } from '../land-detail.service';
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
  imports: [CommonModule, VillaArtComponent, MfDisclaimerComponent, MfdDisclosureComponent],
  templateUrl: './villa-buy.component.html',
  styleUrls: ['../villa/villa-detail.component.scss', './villa-buy.component.scss'],
})
export class VillaBuyComponent implements OnInit {
  private booking = inject(BookingService);
  private auth = inject(AuthService);

  /** Investment amount presets the user can pick. */
  readonly PRESETS = [10_00_000, 25_00_000, 50_00_000, 1_00_00_000];
  amount = signal(25_00_000);

  @Input() name = 'Signature Villa';
  /** Ticket size to open on (chosen on the Explore villa feed). */
  @Input() startAmount = 25_00_000;
  @Output() back = new EventEmitter<void>();

  plan!: VillaPlan;
  stack: StackYear[] = [];

  // format helpers
  compact = compact;
  compactK = compactK;
  assetColor = assetColor;

  // ── fund backtest (growth-of-money chart) ──
  private landSvc = inject(LandDetailService);
  bt = signal<VillaBacktest | null>(null);
  btLoading = signal(true);
  /** colour per fund role for the chart lines + legend */
  readonly roleColor: Record<string, string> = {
    equity: '#0f7a6b', gold: '#c8862b', arbitrage: '#3a7ca5',
  };

  ngOnInit(): void {
    if (this.startAmount) this.amount.set(this.startAmount);
    this.recompute();
    this.loadBacktest();
  }

  private loadBacktest(): void {
    this.btLoading.set(true);
    this.landSvc.villaBacktest(this.amount()).subscribe({
      next: (r) => { this.bt.set(r && r.ok ? r : null); this.btLoading.set(false); },
      error: () => { this.bt.set(null); this.btLoading.set(false); },
    });
  }

  // ── chart geometry (log-scale growth-of-money) ──
  readonly chartW = 320;
  readonly chartH = 200;
  private readonly padL = 8; private readonly padR = 44;
  private readonly padT = 12; private readonly padB = 22;

  /** All series (per-fund + the blend), for drawing lines + legend. */
  get series(): { key: string; name: string; color: string; index: number[]; mult: number; blend?: boolean }[] {
    const b = this.bt();
    if (!b) return [];
    const funds = Object.entries(b.per_fund).map(([key, f]) => ({
      key, name: f.name, color: this.roleColor[f.role] || '#888',
      index: f.index, mult: f.mult,
    }));
    return [
      ...funds,
      { key: 'blend', name: 'Your villa', color: '#14202e', index: b.blend_index, mult: b.blend_mult, blend: true },
    ];
  }

  private get logBounds(): { min: number; max: number } {
    const b = this.bt();
    if (!b) return { min: 100, max: 1600 };
    let max = 100;
    for (const f of Object.values(b.per_fund)) max = Math.max(max, ...f.index);
    max = Math.max(max, ...b.blend_index);
    return { min: 100, max };
  }
  private x(i: number, n: number): number {
    return this.padL + (i / Math.max(1, n - 1)) * (this.chartW - this.padL - this.padR);
  }
  private y(v: number): number {
    const { min, max } = this.logBounds;
    const t = (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min) || 1);
    return this.padT + (1 - t) * (this.chartH - this.padT - this.padB);
  }
  /** SVG path for one series' index array. */
  path(index: number[]): string {
    if (!index.length) return '';
    return index.map((v, i) => `${i === 0 ? 'M' : 'L'}${this.x(i, index.length).toFixed(1)},${this.y(v).toFixed(1)}`).join(' ');
  }
  /** End-of-line y for placing the "7.3×" label. */
  endY(index: number[]): number { return index.length ? this.y(index[index.length - 1]) : 0; }
  endX(): number { return this.chartW - this.padR + 3; }

  /** Log Y-axis gridline values (₹100, 200, 400, …) within bounds. */
  get yTicks(): { v: number; y: number }[] {
    const { max } = this.logBounds;
    const out: { v: number; y: number }[] = [];
    for (let v = 100; v <= max * 1.001; v *= 2) out.push({ v, y: this.y(v) });
    return out;
  }
  /** A few x-axis year labels. */
  get xTicks(): { label: string; x: number }[] {
    const b = this.bt();
    if (!b) return [];
    const n = b.dates.length;
    const out: { label: string; x: number }[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 4))) {
      out.push({ label: b.dates[i].slice(0, 4), x: this.x(i, n) });
    }
    return out;
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
      { theme: 'rent',  ico: I['coin'],  stat: compact(this.plan.rentMonthly),            unit: 'income*',    vs: 'targeted monthly payout, not guaranteed' },
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

  // ---- book now: pick a day → time → how you'll pay → confirmed ----
  bookOpen = signal(false);
  bkStep = signal(1);
  bkMonth = signal(this.firstOfThisMonth());
  bkDay = signal<Date | null>(null);
  bkSlot = signal<string | null>(null);      // "HH:MM AM" label
  bkSlotIso = signal<string | null>(null);   // ISO datetime posted to the API
  justBooked = signal(false);
  /** Real free slots for the picked day, from the advisor's availability. */
  bkSlots = signal<{ time: string; label: string; slot: string }[]>([]);
  bkSlotsLoading = signal(false);
  /** How the client will fund it: a monthly SIP, or the full amount now. */
  bkPay = signal<'sip' | 'buy'>('buy');
  bkSubmitting = signal(false);
  bkError = signal('');

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
    this.bkSlot.set(null); this.bkSlotIso.set(null);
    this.bkStep.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
    // load only the slots the advisor is actually free on this day
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    this.bkSlotsLoading.set(true);
    this.bkSlots.set([]);
    this.booking.freeSlots(iso).subscribe({
      next: (r) => {
        this.bkSlots.set((r.slots || []).map((s) => ({ time: s.time, slot: s.slot, label: this.slotLabel(s.time) })));
        this.bkSlotsLoading.set(false);
      },
      error: () => { this.bkSlots.set([]); this.bkSlotsLoading.set(false); },
    });
  }

  private slotLabel(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  /** Pick a time → go to the "how you'll pay" step (SIP vs full). */
  bkPickSlot(slot: { label: string; slot: string }): void {
    this.bkSlot.set(slot.label);
    this.bkSlotIso.set(slot.slot);
    this.bkPay.set('buy');
    this.bkError.set('');
    this.bkStep.set(3);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  /** Confirm: create a REAL request that lands in the advisor's calendar. */
  bkConfirm(): void {
    if (this.bkSubmitting() || !this.bkSlotIso()) return;
    const u = this.auth.user();
    const name = (u?.name || '').trim() || 'Client';
    const phone = (u?.phone || '').replace(/\D/g, '').slice(-10);
    this.bkSubmitting.set(true);
    this.bkError.set('');
    this.booking.createBooking({
      name, phone,
      kind: this.bkPay(),                 // 'sip' or 'buy'
      property: 'villa',
      variant: 'balanced',
      amount: this.amount(),
      slot: this.bkSlotIso()!,
      note: `${this.name} · ${this.bkPay() === 'sip' ? 'Monthly SIP' : 'Full amount'}`,
    }).subscribe({
      next: () => {
        this.bkSubmitting.set(false);
        this.bkStep.set(4);
        this.justBooked.set(true);
        if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
        setTimeout(() => this.justBooked.set(false), 1600);
      },
      error: () => { this.bkSubmitting.set(false); this.bkError.set('Could not book that slot. Please try again.'); },
    });
  }

  onBack(): void { this.back.emit(); }
  trackFund(_i: number, f: HoldingFund): string { return f.name; }
  trackYear(_i: number, s: StackYear): number { return s.year; }
}
