import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { VillaArtComponent } from '../shared/villa-art.component';
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
  imports: [CommonModule, VillaArtComponent, LandArtComponent],
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
    const villaCost = 50_00_000;
    const vplan = villaPlan(villaCost, 20);
    const vRent = Math.round(vplan.rentMonthly);
    const vRent20 = Math.round(vplan.rentYearly * 20);
    const vGrowth20 = Math.round(vplan.finalValue);

    const landCost = 20_00_000;
    const lplan = villaPlan(landCost, 20);
    const lGrowth20 = Math.round(lplan.finalValue);

    return [
      {
        kind: 'villa',
        label: 'VILLA',
        name: 'Villa',
        tag: 'It pays you, every month.',
        cost: villaCost,
        headV: compact(vRent),
        headK: 'paid to you every month',
        worth20: vGrowth20 + vRent20,
        splitA: `${compact(vRent20)} rent`,
        splitB: `${compact(vGrowth20)} growth`,
      },
      {
        kind: 'land',
        label: 'PLOT',
        name: 'Plot',
        tag: 'Pure growth — it compounds.',
        cost: landCost,
        headV: '12%',
        headK: 'growth every year',
        worth20: lGrowth20,
        splitA: `${compact(landCost)} in`,
        splitB: `${compact(lGrowth20)} out`,
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
    this.swipeY = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }
  onUp(e: PointerEvent): void {
    if (this.swipeY === null) return;
    const dy = e.clientY - this.swipeY;
    this.swipeY = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (Math.abs(dy) > 50) this.goTo(this.index() + (dy < 0 ? 1 : -1)); // swipe up → next
  }
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaY) < 24) return;
    this.goTo(this.index() + (e.deltaY > 0 ? 1 : -1));
  }
}
