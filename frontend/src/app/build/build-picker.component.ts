import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';
import { villaPlan } from '../villa/villa-detail.model';

/** One row of the one-word eVilla-vs-real-villa comparison. */
interface Compare {
  label: string;   // what's being compared, e.g. "Setup"
  ours: string;    // eVilla, one word — e.g. "Instant"
  theirs: string;  // real villa, one word — e.g. "Months"
}

/** One full-screen asset in the Explore feed. */
interface ExploreItem {
  kind: 'villa' | 'land';
  name: string;
  price: number;
  rent: string;         // "₹15,000/mo" or "—"
  rentK: string;        // label under the rent figure
  compare: Compare[];   // one-word eVilla vs real villa rows
}

/**
 * Explore — a full-screen, swipe-up feed of assets you can buy. One asset fills
 * the screen (a "for sale" board on its image, price + rent at the top, and
 * five reasons it beats a real villa below). Swiping up moves to the next.
 * Tapping Buy opens that asset's dedicated buy page (villa-buy / land-buy).
 */
@Component({
  selector: 'app-build-picker',
  standalone: true,
  imports: [CommonModule, VillaArtComponent, LandArtComponent],
  templateUrl: './build-picker.component.html',
  styleUrl: './build-picker.component.scss',
})
export class BuildPickerComponent {
  /** When true (as the Explore tab) the back button is hidden. */
  @Input() embedded = false;
  @Output() back = new EventEmitter<void>();
  @Output() pick = new EventEmitter<'villa' | 'land'>();

  /** Which card is showing in the feed. */
  index = signal(0);

  readonly items: ExploreItem[] = this.buildItems();

  private buildItems(): ExploreItem[] {
    const villaPrice = 30_00_000;
    const landPrice = 10_00_000;
    const vplan = villaPlan(villaPrice, 20);
    const villaRent = Math.round(vplan.rentMonthly);

    // one-word eVilla vs real-villa comparison
    const COMMON: Compare[] = [
      { label: 'Setup',       ours: 'Instant',  theirs: 'Months' },
      { label: 'Paperwork',   ours: 'None',     theirs: 'Endless' },
      { label: 'Stamp duty',  ours: '₹0',       theirs: '7%' },
      { label: 'Maintenance', ours: '₹0',       theirs: 'Yearly' },
      { label: 'Selling',     ours: 'A tap',    theirs: 'Brokers' },
    ];

    return [
      {
        kind: 'villa',
        name: 'Signature Villa',
        price: villaPrice,
        rent: `${compact(villaRent)}/mo`,
        rentK: 'rent from day one',
        compare: COMMON,
      },
      {
        kind: 'land',
        name: 'Growth Plot',
        price: landPrice,
        rent: '12%',
        rentK: 'yearly growth',
        compare: COMMON,
      },
    ];
  }

  compact = compact;

  buy(kind: 'villa' | 'land'): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(kind);
  }
  onBack(): void { this.back.emit(); }

  goTo(i: number): void {
    this.index.set(Math.max(0, Math.min(this.items.length - 1, i)));
  }

  // --- swipe up/down between full-screen cards ---
  private swipeY: number | null = null;
  onDown(e: PointerEvent): void {
    this.swipeY = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }
  onUp(e: PointerEvent): void {
    if (this.swipeY === null) return;
    const dy = e.clientY - this.swipeY;
    this.swipeY = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (Math.abs(dy) > 50) this.goTo(this.index() + (dy < 0 ? 1 : -1)); // up → next
  }
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaY) < 20) return;
    this.goTo(this.index() + (e.deltaY > 0 ? 1 : -1));
  }
}
