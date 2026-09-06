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
  incomeMonthly: number; // rent-like monthly income once built
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
    // Three villa tiers with their monthly rent-like income once built.
    return [
      { name: '₹10 L Villa', cost: 10_00_000, sipMonthly: 10_000, incomeMonthly: 3_000 },
      { name: '₹50 L Villa', cost: 50_00_000, sipMonthly: 25_000, incomeMonthly: 15_000 },
      { name: '₹1 Cr Villa', cost: 1_00_00_000, sipMonthly: 50_000, incomeMonthly: 30_000 },
    ];
  }

  buy(cost: number): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(cost);
  }
  onBack(): void { this.back.emit(); }
}
