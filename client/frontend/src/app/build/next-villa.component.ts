import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';

import { BookingSheetComponent } from '../booking-sheet.component';
import { HOUSE, HOUSES, INCOME, ORDER } from '../estate-home.component';
import { EstateService } from '../estate.service';
import { CountUpDirective } from '../shared/count-up.directive';
import { compact, inr } from '../shared/format.util';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { loadTileSprite } from '../shared/tile-sprite';

const L = 100_000;
/** Build-stage art per ₹1L put into a plot (0 ground … 4 steel), from the sprite. */
const STAGE_ART = ['#lvGround', '#lvLand', '#lvGrade', '#lvFound', '#lvSteel'];
const STAGE_NAME = ['Breaking ground', 'The plot', 'Levelled', 'Foundation', 'Steel frame'];

/** One parcel on the preview board. */
interface Cell {
  key: string;              // idx + art — a changed key re-creates the node, replaying its pop
  x: number; y: number; d: number;
  href: string;             // sprite symbol, or '' for an open lawn
  isNew: boolean;           // this parcel changes because of the amount being added
}

/** One rung on the road to a full estate. */
interface Rung { n: number; need: number; income: number; owned: boolean; reached: boolean; }

/**
 * NEXT VILLA — what the "+" on the home board opens.
 *
 * A what-if for the client's OWN estate: drag an amount and the board, the villa
 * count and the monthly payout all update live, using the same model the home
 * board is generated from (₹5L = one villa = ₹1,500 a month). Ends in a request
 * to the advisor for exactly that amount.
 */
@Component({
  selector: 'app-next-villa',
  standalone: true,
  imports: [CommonModule, CountUpDirective, BookingSheetComponent, MfDisclaimerComponent],
  templateUrl: './next-villa.component.html',
  styleUrl: './next-villa.component.scss',
})
export class NextVillaComponent implements OnInit {
  private est = inject(EstateService);
  @Output() back = new EventEmitter<void>();

  inr = inr;
  compact = compact;
  readonly HOUSE = HOUSE;
  readonly INCOME = INCOME;
  readonly HOUSES = HOUSES;
  readonly STEP = 50_000;

  /** What is on the board today — invested ₹, capped at the nine parcels. */
  readonly worth = Math.min(HOUSES * HOUSE, Math.max(0, this.est.invested));
  readonly villas = Math.floor(this.worth / HOUSE);
  readonly rem = this.worth - this.villas * HOUSE;
  /** ₹ that completes the next villa (the plot in progress, or a fresh one). */
  readonly toNext = HOUSE - this.rem;
  /** Room left on the board. */
  readonly capacity = HOUSES * HOUSE - this.worth;
  readonly max = Math.max(this.STEP, this.capacity);

  /** The amount being considered. Opens on exactly what finishes the next villa. */
  add = signal(0);

  ngOnInit(): void {
    loadTileSprite();
    this.add.set(Math.min(this.max, this.toNext));
  }

  // ── presets: finish the next villa, then one and two more ──
  presets = [0, 1, 2]
    .map((k) => ({ amt: this.toNext + k * HOUSE, villas: this.villas + 1 + k }))
    .filter((p) => p.amt <= this.max);

  setAdd(v: number): void {
    const n = Math.max(this.STEP, Math.min(this.max, Math.round(v / this.STEP) * this.STEP));
    // a preset may not sit on the ₹50K grid (e.g. ₹1,80,000 to finish) — keep it exact
    this.add.set(this.presets.some((p) => p.amt === v) ? v : n);
  }
  onSlide(ev: Event): void { this.setAdd(Number((ev.target as HTMLInputElement).value)); }
  pick(amt: number): void { this.add.set(amt); if (navigator.vibrate) navigator.vibrate(4); }

  // ── the estate after the amount goes in ──
  private after = computed(() => this.worth + this.add());
  villasAfter = computed(() => Math.min(HOUSES, Math.floor(this.after() / HOUSE)));
  remAfter = computed(() => this.after() - this.villasAfter() * HOUSE);
  newVillas = computed(() => this.villasAfter() - this.villas);
  incomeNow = this.villas * INCOME;
  incomeAfter = computed(() => this.villasAfter() * INCOME);
  /** Slider fill, 0..100. */
  fill = computed(() => (this.add() - this.STEP) / Math.max(1, this.max - this.STEP) * 100);

  /** The one-line result under the amount. */
  headline = computed(() => {
    const n = this.newVillas(), rem = this.remAfter();
    if (n > 0) {
      const names = Array.from({ length: n }, (_, k) => this.pad(this.villas + 1 + k));
      const what = n === 1 ? `Villa ${names[0]} is complete` : `Villas ${names[0]}–${names[n - 1]} are complete`;
      return rem > 0 ? `${what}, and Plot ${this.pad(this.villasAfter() + 1)} is under way` : what;
    }
    const stage = Math.min(4, Math.floor(rem / L));
    return `Plot ${this.pad(this.villas + 1)} reaches “${STAGE_NAME[stage]}” — ${inr(HOUSE - rem)} from a finished villa`;
  });

  private pad(n: number): string { return ('0' + n).slice(-2); }

  /** The nine parcels as they will stand, back-to-front for painting. */
  cells = computed<Cell[]>(() => {
    const vA = this.villasAfter(), remA = this.remAfter();
    const artAt = (i: number, villas: number, rem: number): string =>
      i < villas ? '#lvVilla' : (i === villas && rem > 0) ? STAGE_ART[Math.min(4, Math.floor(rem / L))] : '';
    return ORDER.map(([col, row], i) => {
      const href = artAt(i, vA, remA);
      return {
        key: i + href, href,
        x: (col - row) * 93.6, y: (col + row) * 54, d: col + row,
        isNew: href !== artAt(i, this.villas, this.rem),
      };
    }).sort((a, b) => a.d - b.d);
  });
  trackCell(_: number, c: Cell): string { return c.key; }

  /** The road to a full estate: every villa, what it takes from today, what it pays. */
  rungs = computed<Rung[]>(() => Array.from({ length: HOUSES }, (_, k) => {
    const n = k + 1;
    return {
      n, need: Math.max(0, n * HOUSE - this.worth), income: n * INCOME,
      owned: n <= this.villas, reached: n > this.villas && n <= this.villasAfter(),
    };
  }));
  trackRung(_: number, r: Rung): number { return r.n; }

  // ── request it ──
  booking = signal(false);
  request(): void { this.booking.set(true); if (navigator.vibrate) navigator.vibrate(4); }

  onBack(): void { this.back.emit(); }
}
