import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { MfDisclaimerComponent } from '../shared/mf-disclaimer.component';
import { compact } from '../shared/format.util';

/** One villa tier. */
interface ExploreItem {
  name: string;         // "₹10 L Villa"
  cost: number;         // ticket size
  sipMonthly: number;   // suggested monthly SIP to build toward it
  tier: string;         // short label under the title
}

/**
 * Explore — one screen showing the three villa tiers a user can start an SIP
 * into (₹10 L, ₹50 L, ₹1 Cr). No land. Header "Villa" with a one-line
 * definition; each tile is tappable to begin an SIP at that ticket size.
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

  buy(cost: number): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(cost);
  }
  onBack(): void { this.back.emit(); }
}
