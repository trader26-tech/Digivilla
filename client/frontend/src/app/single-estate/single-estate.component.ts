import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject } from '@angular/core';

import { EstateService, Tile } from '../estate.service';
import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';

/**
 * The one-villa home. Before a client owns two or more villas, the isometric
 * map grid is overkill — a single house, centred, that visibly "builds up" as
 * money goes in reads far better.
 *
 * The house fills bottom-up like a rising water line: a faint ghost of the
 * villa always shows the finished shape, and a full-colour copy is revealed
 * from the ground up in proportion to how funded it is (0% empty → 100% solid).
 * Below it: current value, next payment, and progress — then a tap opens the
 * full detail page.
 */
@Component({
  selector: 'app-single-estate',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './single-estate.component.html',
  styleUrl: './single-estate.component.scss',
})
export class SingleEstateComponent {
  /** Open the full detail page for the villa. */
  @Output() openTile = new EventEmitter<Tile>();
  /** Corner avatar → account page. */
  @Output() account = new EventEmitter<void>();

  readonly est = inject(EstateService);
  compact = compact;

  /** The single holding this screen represents. */
  readonly tile = computed<Tile | null>(() => this.est.tiles()[0] ?? null);

  /** Build progress 0..100 — drives the water-line fill height. */
  readonly pct = computed<number>(() => {
    const t = this.tile();
    if (!t) return 0;
    return Math.round(this.est.buildProgress(t) * 100);
  });

  /** A finished villa (fully funded) vs one still building. */
  readonly isBuilt = computed<boolean>(() => this.tile()?.type === 'villa');

  /** Money actually in so far. */
  readonly invested = computed<number>(() => {
    const t = this.tile();
    if (!t) return 0;
    return t.type === 'building' ? t.sipAccrued : t.cost;
  });

  /** Monthly income this holding pays (proportional to what's invested). */
  readonly income = computed<number>(() => this.tile()?.rentMonthly ?? 0);

  /** The 1st of next month — the next income payout date. */
  readonly nextPayment = computed<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  });

  /** A warm, time-aware greeting. */
  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  get profile() { return this.est.profile(); }

  open(): void {
    const t = this.tile();
    if (t) {
      if (navigator.vibrate) navigator.vibrate(4);
      this.openTile.emit(t);
    }
  }
}
