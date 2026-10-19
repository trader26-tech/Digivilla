import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, computed, inject, signal } from '@angular/core';

import { GoalsService } from './goals.service';

/** The four parts of the yearly Homecoming trip, in the design's order. */
interface TripCard { color: string; rgb: string; num: string; label: string; title: string; sub: string; delay: string; }

/** Homecoming — "Estimate it": the yearly trip built from four illustrated cost cards
 *  (Flights · Movies & dinners · Shopping · Vacation), each with an always-open
 *  − / ₹ amount / + row, a sticky "Trip total" footer and the "Fund it every year"
 *  sheet (invest once = villas × villa cost, counting up). Design: Trip Home Builder.dc.html. */
@Component({
  selector: 'app-goals-trip-builder',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './goals-trip-builder.component.html',
  styleUrl: './goals-trip-builder.component.scss',
})
export class GoalsTripBuilderComponent implements OnDestroy {
  readonly goals = inject(GoalsService);
  @Output() back = new EventEmitter<void>();
  @Output() fund = new EventEmitter<void>();

  readonly cards: TripCard[] = [
    { color: '#9a8cf0', rgb: '154,140,240', num: '01', label: 'Flights', title: 'Dubai ⇄ Kochi', sub: 'Return tickets, family of four', delay: '0s' },
    { color: '#f3a06a', rgb: '243,160,106', num: '02', label: 'Movies & dinners', title: 'Weekend nights out', sub: 'Six tickets, three dinners', delay: '0.07s' },
    { color: '#f6c445', rgb: '246,196,69', num: '03', label: 'Shopping', title: 'Gold, sarees & gifts', sub: 'Lulu Mall haul, 14 December', delay: '0.14s' },
    { color: '#8fd65a', rgb: '143,214,90', num: '04', label: 'Vacation', title: 'Agra, Delhi & Goa', sub: 'Ten days, three cities', delay: '0.21s' },
  ];

  /** the raw string while a part is being typed (formatted en-IN live) */
  readonly typing = signal<{ k: number; s: string } | null>(null);
  readonly plan = signal(false);
  /** the count-up figure in the sheet (null = settled at the real amount) */
  readonly shown = signal<number | null>(null);
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly parts = computed(() => this.goals.tripParts());
  readonly total = computed(() => this.parts().reduce((a, b) => a + b, 0));
  readonly villas = computed(() => this.goals.villasForYearly(this.total()));
  readonly invest = computed(() => this.villas() * this.goals.villaCost());
  readonly pay = computed(() => this.villas() * this.goals.perVillaYear());
  readonly spare = computed(() => this.pay() - this.total());
  readonly investTxt = computed(() => this.goals.lakhShort(this.shown() ?? this.invest()));
  readonly villaIcons = computed(() => Array.from({ length: Math.min(this.villas(), 8) }, (_, i) => (0.2 + i * 0.06).toFixed(2) + 's'));
  readonly villaLbl = computed(() => {
    const v = this.villas();
    return (v > 8 ? '+' + (v - 8) + ' · ' : '') + v + ' villa' + (v > 1 ? 's' : '') + ' · ' + this.goals.lakhShort(this.goals.villaCost()) + ' each';
  });

  // ── the amount row ──
  typed(k: number): string {
    const t = this.typing();
    return t && t.k === k ? t.s : this.parts()[k].toLocaleString('en-IN');
  }
  /** the input widens to its content (0.6em a character + a little air) */
  width(k: number): string { return (Math.max(2, this.typed(k).length) * 0.6 + 0.4).toFixed(1) + 'em'; }
  private write(k: number, v: number): void {
    const a = this.parts().slice();
    a[k] = v;
    this.goals.setTripParts(a);
  }
  set(k: number, v: number): void { this.write(k, Math.max(1000, Math.min(9_999_999, v))); this.typing.set(null); }
  dec(k: number): void { this.set(k, Math.max(1000, this.parts()[k] - 1000)); }
  inc(k: number): void { this.set(k, this.parts()[k] + 1000); }
  onType(k: number, e: Event): void {
    const el = e.target as HTMLInputElement;
    const raw = String(el.value).replace(/\D/g, '').slice(0, 7), n = +raw || 0;
    const s = n ? n.toLocaleString('en-IN') : '';
    el.value = s;                         // digits only, grouped as you type
    this.write(k, n);
    this.typing.set({ k, s });
  }
  onBlur(k: number): void {
    const a = this.parts().slice();
    a[k] = Math.max(1000, a[k] || 0);
    this.goals.setTripParts(a);
    this.typing.set(null);
  }

  // ── the "Fund it every year" sheet ──
  showPlan(): void {
    if (!this.goals.data()) return;
    this.plan.set(true);
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { this.shown.set(null); return; }
    this.shown.set(0);
    this.clear();
    this.timer = setTimeout(() => this.tick(this.invest()), 250);
  }
  hidePlan(): void { this.plan.set(false); this.clear(); this.shown.set(null); }
  private tick(target: number): void {
    cancelAnimationFrame(this.raf);
    const t0 = performance.now(), D = 1100;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      this.shown.set(p < 1 ? Math.round(target * e) : null);
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  private clear(): void { cancelAnimationFrame(this.raf); if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  ngOnDestroy(): void { this.clear(); }
}
