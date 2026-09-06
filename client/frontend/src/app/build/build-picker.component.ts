import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact } from '../shared/format.util';

/** One villa tier in the Explore feed. */
interface ExploreItem {
  name: string;         // "₹10 L Villa"
  cost: number;         // ticket size
  sipMonthly: number;   // suggested monthly SIP to build toward it
  tier: string;         // short label under the title
}

/**
 * Explore — a swipe feed of the three villa tiers a user can start an SIP into
 * (₹10 L, ₹50 L, ₹1 Cr). No land. Header "Villa" with a one-line definition;
 * each card is tappable to begin an SIP at that ticket size.
 */
@Component({
  selector: 'app-build-picker',
  standalone: true,
  imports: [CommonModule, VillaArtComponent, MfDisclaimerComponent],
  templateUrl: './build-picker.component.html',
  styleUrl: './build-picker.component.scss',
})
export class BuildPickerComponent {
  @Input() embedded = false;
  @Output() back = new EventEmitter<void>();
  /** Emits the chosen ticket size (₹) so the villa page opens on that amount. */
  @Output() pick = new EventEmitter<number>();

  compact = compact;

  index = signal(0);
  readonly items: ExploreItem[] = this.buildItems();

  private buildItems(): ExploreItem[] {
    // Three villa tiers. Suggested SIP is a small monthly toward the ticket
    // (illustrative — the user can change it on the next page).
    const tiers = [10_00_000, 50_00_000, 1_00_00_000];
    return tiers.map((cost) => ({
      name: `${compact(cost)} Villa`,
      cost,
      sipMonthly: this.suggestSip(cost),
      tier: 'Start a monthly SIP toward this villa',
    }));
  }

  /** A gentle suggested SIP: ~0.5% of the ticket / month, rounded to ₹1,000. */
  private suggestSip(cost: number): number {
    return Math.max(1000, Math.round((cost * 0.005) / 1000) * 1000);
  }

  goTo(i: number): void {
    this.index.set(Math.max(0, Math.min(this.items.length - 1, i)));
  }

  buy(cost: number): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(cost);
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
