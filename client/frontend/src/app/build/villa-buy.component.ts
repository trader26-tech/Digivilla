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

  // ── fund backtest (stacked-area growth chart) ──
  private landSvc = inject(LandDetailService);
  bt = signal<VillaBacktest | null>(null);
  btLoading = signal(true);

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

  // ── stacked-area chart geometry ──
  readonly chartW = 320;
  readonly chartH = 190;
  readonly padL = 6; readonly padR = 6;
  readonly padT = 10; readonly padB = 20;

  private get maxTotal(): number {
    const b = this.bt();
    return b ? Math.max(...b.total, 1) : 1;
  }
  private x(i: number, n: number): number {
    return this.padL + (i / Math.max(1, n - 1)) * (this.chartW - this.padL - this.padR);
  }
  private y(v: number): number {
    return this.padT + (1 - v / this.maxTotal) * (this.chartH - this.padT - this.padB);
  }

  /** Stacked areas: each band drawn between its running-cumulative baseline and
   *  the top of the stack below it. Returns closed SVG polygon paths bottom→top. */
  get areas(): { color: string; name: string; d: string }[] {
    const b = this.bt();
    if (!b) return [];
    const n = b.dates.length;
    const below = new Array(n).fill(0);   // cumulative baseline
    const out: { color: string; name: string; d: string }[] = [];
    for (const band of b.bands) {
      const top = below.map((base, i) => base + band.values[i]);
      // top edge L→R, then bottom edge R→L
      let d = top.map((v, i) => `${i === 0 ? 'M' : 'L'}${this.x(i, n).toFixed(1)},${this.y(v).toFixed(1)}`).join(' ');
      for (let i = n - 1; i >= 0; i--) d += ` L${this.x(i, n).toFixed(1)},${this.y(below[i]).toFixed(1)}`;
      d += ' Z';
      out.push({ color: band.color, name: band.name, d });
      for (let i = 0; i < n; i++) below[i] = top[i];
    }
    return out;
  }

  /** ₹ Y-axis ticks (nice round values up to the max total). */
  get yTicks(): { label: string; y: number }[] {
    const max = this.maxTotal;
    const out: { label: string; y: number }[] = [];
    const step = this.niceStep(max / 3);
    for (let v = step; v <= max * 1.001; v += step) out.push({ label: this.compact(v), y: this.y(v) });
    return out;
  }
  private niceStep(raw: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const f = n >= 5 ? 5 : n >= 2 ? 2 : 1;
    return f * pow;
  }
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

  // ---- book now: one screen — the next open days with their free slots ----
  bookOpen = signal(false);
  justBooked = signal(false);
  booked = signal(false);                     // shows the confirmed screen
  /** The next few open days, each with the advisor's free 30-min slots. */
  bkDays = signal<{ iso: string; label: string; slots: { label: string; slot: string }[] }[]>([]);
  bkDaysLoading = signal(false);
  bkSlotIso = signal<string | null>(null);    // the chosen slot (ISO)
  bkSlotLabel = signal<string>('');           // "Mon 8 Sep · 10:00 AM"
  /** How the client will fund it: full amount now, or a monthly SIP. */
  bkPay = signal<'sip' | 'buy'>('buy');
  bkSubmitting = signal(false);
  bkError = signal('');

  openBook(): void {
    this.booked.set(false);
    this.justBooked.set(false);
    this.bkSlotIso.set(null);
    this.bkSlotLabel.set('');
    this.bkPay.set('buy');
    this.bkError.set('');
    this.bookOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
    this.loadNextOpenDays();
  }
  closeBook(): void { this.bookOpen.set(false); }

  /** Load the next few working days that actually have free slots, each with
   *  its times — so the sheet shows everything at once (no day-then-time hops). */
  private loadNextOpenDays(): void {
    this.bkDaysLoading.set(true);
    this.bkDays.set([]);
    // candidate dates: the next ~14 days, starting tomorrow
    const cands: Date[] = [];
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
    for (let i = 0; i < 14; i++) { cands.push(new Date(d)); d.setDate(d.getDate() + 1); }
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    Promise.all(cands.map((x) =>
      new Promise<{ iso: string; label: string; slots: { label: string; slot: string }[] }>((resolve) => {
        this.booking.freeSlots(iso(x)).subscribe({
          next: (r) => resolve({
            iso: iso(x),
            label: `${wk[x.getDay()]}, ${x.getDate()} ${mo[x.getMonth()]}`,
            slots: (r.slots || []).map((s) => ({ label: this.slotLabel(s.time), slot: s.slot })),
          }),
          error: () => resolve({ iso: iso(x), label: '', slots: [] }),
        });
      })
    )).then((all) => {
      // keep only days that have at least one free slot; show the first 4
      this.bkDays.set(all.filter((day) => day.slots.length).slice(0, 4));
      this.bkDaysLoading.set(false);
    });
  }

  private slotLabel(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  /** Tap a slot chip — just selects it (Confirm is on the same screen). */
  pickSlot(dayLabel: string, s: { label: string; slot: string }): void {
    this.bkSlotIso.set(s.slot);
    this.bkSlotLabel.set(`${dayLabel} · ${s.label}`);
    this.bkError.set('');
    if (navigator.vibrate) navigator.vibrate(4);
  }
  isSlot(s: { slot: string }): boolean { return this.bkSlotIso() === s.slot; }

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
        this.booked.set(true);
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
