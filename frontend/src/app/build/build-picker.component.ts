import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { VillaArtComponent } from '../shared/villa-art.component';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact } from '../shared/format.util';
import { villaPlan } from '../villa/villa-detail.model';

/** One asset in the Explore feed. */
interface ExploreItem {
  kind: 'villa' | 'land';
  label: string;        // "VILLA" / "PLOT" — the top-bar word
  name: string;
  tag: string;          // the one-line promise
  cost: number;
  headV: string;        // the headline figure (rent/mo or growth)
  headK: string;        // its label
  worth20: number;      // worth in 20 years
  splitA: string;       // breakdown left
  splitB: string;       // breakdown right
}

/**
 * Explore — a swipe-DOWN feed of assets to buy. The top bar shows "EXPLORE ·
 * <ASSET> · n OF N" with pagination dots so the user knows there's more below.
 * Each asset fills the screen at the same size. "Tap to know more" opens that
 * asset's page.
 */
@Component({
  selector: 'app-build-picker',
  standalone: true,
  imports: [CommonModule, VillaArtComponent, LandArtComponent, MfDisclaimerComponent],
  templateUrl: './build-picker.component.html',
  styleUrl: './build-picker.component.scss',
})
export class BuildPickerComponent {
  @Input() embedded = false;
  @Output() back = new EventEmitter<void>();
  @Output() pick = new EventEmitter<'villa' | 'land'>();

  compact = compact;

  index = signal(0);
  readonly items: ExploreItem[] = this.buildItems();

  private buildItems(): ExploreItem[] {
    // NO forward return projections shown. The villa maps to an SWP the user
    // sets up; the plot to a growth fund held at NAV. Figures below describe
    // the SETUP the user chooses, not an expected return.
    const villaCost = 50_00_000;
    const villaSwp = Math.round((villaCost * 0.06) / 12); // a 6%/yr SWP the user may set

    const landCost = 20_00_000;

    return [
      {
        kind: 'villa',
        label: 'VILLA',
        name: 'Villa',
        tag: 'A fund with a monthly SWP you set up.',
        cost: villaCost,
        headV: compact(villaSwp),
        headK: 'SWP you set — withdraws your own units*',
        // legacy fields kept for the type; no longer shown
        worth20: 0,
        splitA: '',
        splitB: '',
      },
      {
        kind: 'land',
        label: 'PLOT',
        name: 'Plot',
        tag: 'A growth fund, held in your name at NAV.',
        cost: landCost,
        headV: 'At NAV',
        headK: 'value moves with the market*',
        worth20: 0,
        splitA: '',
        splitB: '',
      },
    ];
  }

  goTo(i: number): void {
    this.index.set(Math.max(0, Math.min(this.items.length - 1, i)));
  }

  buy(kind: 'villa' | 'land'): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(kind);
  }
  onBack(): void { this.back.emit(); }

  // --- swipe down/up between full-screen cards ---
  private swipeY: number | null = null;
  onDown(e: PointerEvent): void {
    // NOTE: no setPointerCapture here — capturing steals the pointerup from the
    // Buy button and kills its click. We just note where the finger went down.
    this.swipeY = e.clientY;
  }
  onUp(e: PointerEvent): void {
    if (this.swipeY === null) return;
    const dy = e.clientY - this.swipeY;
    this.swipeY = null;
    // Only a real vertical drag counts as a swipe; a tap (tiny move) falls
    // through so the button underneath receives its click normally.
    if (Math.abs(dy) > 50) this.goTo(this.index() + (dy < 0 ? 1 : -1)); // swipe up → next
  }
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaY) < 24) return;
    this.goTo(this.index() + (e.deltaY > 0 ? 1 : -1));
  }
}
