import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';
import { villaPlan } from '../villa/villa-detail.model';

/** One full-screen asset in the Explore feed. */
interface ExploreItem {
  kind: 'villa' | 'land';
  name: string;
  price: number;
  rent: string;         // "₹15,000/mo" or "—"
  rentK: string;        // label under the rent figure
  perks: { ico: string; stat: string; unit: string; vs: string }[];
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

  private static readonly ICO: Record<string, string> = {
    tag:   'M4 13V4h9l7 7-9 9zM8 8h.01',
    coin:  'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6',
    chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:  'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:  'M13 3L5 13h5l-1 8 8-10h-5z',
    swap:  'M4 8h13l-3-3M20 16H7l3 3',
    door:  'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M9 12h.5',
  };

  readonly items: ExploreItem[] = this.buildItems();

  private buildItems(): ExploreItem[] {
    const I = BuildPickerComponent.ICO;
    const villaPrice = 30_00_000;
    const landPrice = 10_00_000;
    const vplan = villaPlan(villaPrice, 20);
    const villaRent = Math.round(vplan.rentMonthly);
    const stamp = (p: number) => compact(Math.round(p * 0.07));

    return [
      {
        kind: 'villa',
        name: 'Signature Villa',
        price: villaPrice,
        rent: `${compact(villaRent)}/mo`,
        rentK: 'rent from day one',
        perks: [
          { ico: I['coin'],  stat: `${compact(villaRent)}`, unit: 'rent',        vs: 'in your account monthly' },
          { ico: I['tag'],   stat: stamp(villaPrice),        unit: 'saved',       vs: 'in 7% stamp duty & registration' },
          { ico: I['tool'],  stat: '₹0',                     unit: 'maintenance', vs: 'no repairs, no upkeep' },
          { ico: I['bolt'],  stat: '30 sec',                 unit: 'to own',      vs: 'not 45 days of paperwork' },
          { ico: I['swap'],  stat: '2 days',                 unit: 'to cash out', vs: 'not 6+ months of brokers' },
        ],
      },
      {
        kind: 'land',
        name: 'Growth Plot',
        price: landPrice,
        rent: '12%',
        rentK: 'expected yearly growth',
        perks: [
          { ico: I['chart'], stat: '12%',            unit: 'a year',      vs: 'pure compounding growth' },
          { ico: I['tag'],   stat: stamp(landPrice), unit: 'saved',       vs: 'in 7% stamp duty & registration' },
          { ico: I['door'],  stat: compact(landPrice), unit: 'to start',  vs: 'not a ₹1 Cr down-payment' },
          { ico: I['tool'],  stat: '₹0',             unit: 'maintenance', vs: 'no fences, no caretaker' },
          { ico: I['swap'],  stat: '2 days',         unit: 'to cash out', vs: 'not months with brokers' },
        ],
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
