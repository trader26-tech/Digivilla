import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';

import { environment } from '../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { BookingService } from '../booking.service';
import { compact, compactK } from '../shared/format.util';
import {
  HoldingFund,
  VillaPlan,
  assetColor,
  assetLabel,
  villaPlan,
} from '../villa/villa-detail.model';

/** One row of the money ledger (a contribution or a rent payout). */
interface LedgerRow { kind?: string; amount: number; date: string; status?: string; note?: string; }
/** A fund inside the villa, with how much of the invested money sits in it. */
interface HoldFund { fund_name: string; role: string; weight: number; invested: number; target: number; }

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
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private bookingSvc = inject(BookingService);

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
  /** The holding id (user_villas id) — used to fetch the ledger + funds. */
  @Input() holdingId = '';
  @Output() back = new EventEmitter<void>();

  // ── live detail: money ledger + fund concentration (fetched by holdingId) ──
  contributions = signal<LedgerRow[]>([]);
  rentLog = signal<LedgerRow[]>([]);
  funds = signal<HoldFund[]>([]);
  showRent = signal(false);        // toggle: contributions ↔ rent payouts
  fundsOpen = signal(false);       // "Funds inside" starts collapsed
  monthlyIncome = signal(0);

  private loadDetail(): void {
    if (!this.holdingId || !this.auth.token()) return;
    const headers = { Authorization: `Bearer ${this.auth.token()}` };
    this.http.get<any>(`${environment.apiUrl}/me/holding/${this.holdingId}`, { headers }).subscribe({
      next: (d) => {
        this.contributions.set(d.contributions || []);
        this.rentLog.set(d.rent_log || []);
        this.funds.set(d.funds || []);
        this.monthlyIncome.set(d.monthly_income || 0);
      },
      error: () => {},
    });
  }
  toggleFundsInside(): void { this.fundsOpen.update((v) => !v); }

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
    this.loadDetail();
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

  // --- withdraw: one-screen slot picker → real request in the admin calendar ---
  withdrawOpen = signal(false);
  wdDays = signal<{ iso: string; label: string; slots: { label: string; slot: string }[] }[]>([]);
  wdDaysLoading = signal(false);
  wdSlotIso = signal<string | null>(null);
  wdSlotLabel = signal('');
  wdSubmitting = signal(false);
  wdError = signal('');
  booked = signal(false);
  justBooked = signal(false);

  openWithdraw(): void {
    this.booked.set(false);
    this.justBooked.set(false);
    this.wdSlotIso.set(null); this.wdSlotLabel.set(''); this.wdError.set('');
    this.withdrawOpen.set(true);
    if (navigator.vibrate) navigator.vibrate(4);
    this.loadWdDays();
  }
  closeWithdraw(): void { this.withdrawOpen.set(false); }

  private loadWdDays(): void {
    this.wdDaysLoading.set(true);
    this.wdDays.set([]);
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.bookingSvc.freeDays(4).subscribe({
      next: (r) => {
        this.wdDays.set((r.days || []).map((day) => {
          const [y, m, d] = day.date.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          return {
            iso: day.date,
            label: `${wk[dt.getDay()]}, ${dt.getDate()} ${mo[dt.getMonth()]}`,
            slots: (day.slots || []).map((s) => ({ label: this.slotLabel(s.time), slot: s.slot })),
          };
        }));
        this.wdDaysLoading.set(false);
      },
      error: () => { this.wdDays.set([]); this.wdDaysLoading.set(false); },
    });
  }
  private slotLabel(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }
  wdPick(dayLabel: string, s: { label: string; slot: string }): void {
    this.wdSlotIso.set(s.slot);
    this.wdSlotLabel.set(`${dayLabel} · ${s.label}`);
    this.wdError.set('');
    if (navigator.vibrate) navigator.vibrate(4);
  }
  wdIsSlot(s: { slot: string }): boolean { return this.wdSlotIso() === s.slot; }

  wdConfirm(): void {
    if (this.wdSubmitting() || !this.wdSlotIso()) return;
    const u = this.auth.user();
    const name = (u?.name || '').trim() || 'Client';
    const phone = (u?.phone || '').replace(/\D/g, '').slice(-10);
    this.wdSubmitting.set(true);
    this.wdError.set('');
    this.bookingSvc.createBooking({
      name, phone,
      kind: 'withdraw',
      property: 'villa',
      variant: 'balanced',
      amount: this.investedSoFar,
      slot: this.wdSlotIso()!,
      note: `Withdraw · ${this.name}`,
    }).subscribe({
      next: () => {
        this.wdSubmitting.set(false);
        this.booked.set(true);
        this.justBooked.set(true);
        if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
        setTimeout(() => this.justBooked.set(false), 1600);
      },
      error: () => { this.wdSubmitting.set(false); this.wdError.set('Could not book that slot. Please try again.'); },
    });
  }
}
