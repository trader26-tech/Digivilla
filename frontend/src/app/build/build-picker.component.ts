import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';
import { villaPlan } from '../villa/villa-detail.model';

/**
 * Explore — the one asset you can buy: a Villa. Its plot sits centred (exactly
 * like the home map) with a "FOR SALE" board on it, the price range and rent,
 * and the same swipeable eVilla-vs-real-villa perks carousel used elsewhere.
 * Tapping Buy opens the villa buy page (the 20-year growth projection).
 */
@Component({
  selector: 'app-build-picker',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './build-picker.component.html',
  styleUrl: './build-picker.component.scss',
})
export class BuildPickerComponent {
  /** When true (as the Explore tab) the back button is hidden. */
  @Input() embedded = false;
  @Output() back = new EventEmitter<void>();
  @Output() pick = new EventEmitter<'villa' | 'land'>();

  compact = compact;

  /** Price range + rent for the headline. */
  readonly priceFrom = 10_00_000;
  readonly priceTo = 50_00_000;
  readonly rentMonthly = Math.round(villaPlan(30_00_000, 20).rentMonthly);

  // --- the eVilla-vs-real perks carousel (same design + colours as elsewhere) ---
  private static readonly ICO: Record<string, string> = {
    tag:   'M4 13V4h9l7 7-9 9zM8 8h.01',
    coin:  'M12 3v18M8 7h5a3 3 0 0 1 0 6H8m0 0h6',
    chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
    tool:  'M14 7a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2z',
    bolt:  'M13 3L5 13h5l-1 8 8-10h-5z',
    swap:  'M4 8h13l-3-3M20 16H7l3 3',
  };
  readonly PERKS = (() => {
    const I = BuildPickerComponent.ICO;
    return [
      { theme: 'rent',  ico: I['coin'],  stat: compact(this.rentMonthly), unit: 'a month',     vs: 'rent, in your account' },
      { theme: 'stamp', ico: I['tag'],   stat: '₹0',                      unit: 'to buy',      vs: 'no stamp duty, no registration' },
      { theme: 'care',  ico: I['tool'],  stat: '₹0',                      unit: 'maintenance', vs: 'no repairs, no upkeep' },
      { theme: 'time',  ico: I['bolt'],  stat: '30 sec',                  unit: 'to own',      vs: 'not 45 days of paperwork' },
      { theme: 'cash',  ico: I['swap'],  stat: '2 days',                  unit: 'to cash out', vs: 'not 6+ months of brokers' },
    ];
  })();
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
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (Math.abs(dx) > 40) this.stepPerk(dx < 0 ? 1 : -1);
  }

  buy(): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit('villa');
  }
  onBack(): void { this.back.emit(); }
}
