import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, computed, inject, signal } from '@angular/core';

import { GoalsService } from './goals.service';

interface Wallet { abbr: string; c: string; own: number; }

/** Homecoming — the checkout receipt: the yearly trip, villas needed, the villas the
 *  client already owns (by category, "use N" stepper), how many more to buy, the cost
 *  and what the villas pay back. "Pay" = the app's buy request. Design: Trip Fund v7.dc.html. */
@Component({
  selector: 'app-goals-trip-fund',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-trip-fund.component.html',
  styleUrl: './goals-trip-fund.component.scss',
})
export class GoalsTripFundComponent implements OnDestroy {
  readonly goals = inject(GoalsService);
  @Output() back = new EventEmitter<void>();
  @Output() done = new EventEmitter<void>();

  /** how many owned villas to put towards the trip (null = as many as help) */
  readonly usedPick = signal<number | null>(null);
  readonly ownOpen = signal(false);
  readonly busy = signal(false);
  readonly err = signal('');
  readonly toast = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly ready = computed(() => !!this.goals.data());
  readonly total = computed(() => this.goals.tripAmount());
  readonly need = computed(() => this.goals.villasForYearly(this.total()));
  /** villas already owned, by category (untyped villas count under "Villas") */
  readonly wallet = computed<Wallet[]>(() => {
    const d = this.goals.data();
    const t = d?.by_type;
    return [
      { abbr: 'Agg', c: '#9a8cf0', own: t?.aggressive ?? 0 },
      { abbr: 'Bal', c: '#f3c77a', own: t?.balanced ?? 0 },
      { abbr: 'Cons', c: '#8fd65a', own: t?.conservative ?? 0 },
      { abbr: 'Villas', c: 'rgba(21,22,28,.45)', own: d?.untyped ?? 0 },
    ].filter((k) => k.own > 0);
  });
  readonly ownTotal = computed(() => this.wallet().reduce((s, k) => s + k.own, 0));
  readonly maxUse = computed(() => Math.min(this.ownTotal(), this.need()));
  readonly used = computed(() => Math.min(this.usedPick() ?? this.maxUse(), this.maxUse()));
  readonly buy = computed(() => this.need() - this.used());
  readonly covered = computed(() => this.buy() === 0);
  readonly pay = computed(() => this.buy() * this.goals.villaCost());
  readonly monthly = computed(() => this.need() * this.goals.perVillaMonth());
  readonly yearly = computed(() => this.need() * this.goals.perVillaYear());
  readonly splitN = computed(() => (this.buy() > 1 ? this.buy() : 3));

  readonly heroAmt = computed(() => (this.covered() ? 'nothing' : this.goals.lakhShort(this.pay())));
  readonly ownLbl = computed(() => this.ownTotal() + ' villa' + (this.ownTotal() === 1 ? '' : 's'));
  readonly paySub = computed(() => this.covered()
    ? 'Your villas already pay for the trip'
    : this.buy() + ' villa' + (this.buy() > 1 ? 's' : '') + ' · the money stays yours, only the payout is spent');
  readonly firstTxt = computed(() => this.goals.nextPayday().toLocaleString('en-IN', { day: 'numeric', month: 'short' }));
  readonly paydayTxt = computed(() => {
    const n = this.goals.payday(), r = n % 10, h = n % 100;
    return n + (h >= 11 && h <= 13 ? 'th' : r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th');
  });
  readonly ctaTxt = computed(() => (this.covered() ? 'Confirm trip fund' : 'Pay ' + this.goals.lakhShort(this.pay())));

  dec(): void { if (this.used() > 0) this.usedPick.set(this.used() - 1); }
  inc(): void { if (this.used() < this.maxUse()) this.usedPick.set(this.used() + 1); }

  /** Pay → the buy request (the team completes it; nothing is charged) → toast → back to Goals */
  confirm(): void {
    if (this.busy() || !this.ready()) return;
    if (this.covered()) { this.done.emit(); return; }
    this.busy.set(true); this.err.set('');
    const note = `Homecoming trip fund: ${this.goals.inr(this.total())} a year`;
    this.goals.requestVillas(this.buy(), null, note).subscribe({
      next: () => {
        this.busy.set(false); this.toast.set(true);
        this.timer = setTimeout(() => { this.toast.set(false); this.done.emit(); }, 1600);
      },
      error: () => { this.busy.set(false); this.err.set('Could not send the request. Please try again.'); },
    });
  }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); }
}
