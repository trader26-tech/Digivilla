import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';
import { villaPlan } from '../villa/villa-detail.model';

/**
 * Explore — the Villa, shown as a summary: what it costs to own, the rent it
 * pays every month, and what it's worth in 20 years (with a short breakdown +
 * timeline). "Tap to know more" opens the villa buy page for the full sheet.
 */
@Component({
  selector: 'app-build-picker',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './build-picker.component.html',
  styleUrl: './build-picker.component.scss',
})
export class BuildPickerComponent {
  /** When true (as the Explore tab) the back button acts as "go home". */
  @Input() embedded = false;
  @Output() back = new EventEmitter<void>();
  @Output() pick = new EventEmitter<'villa' | 'land'>();

  compact = compact;

  /** The villa this card is about. */
  readonly cost = 50_00_000;
  private readonly plan = villaPlan(this.cost, 20);

  /** Monthly rent it pays. */
  readonly rentMonthly = Math.round(this.plan.rentMonthly);
  /** What it's worth in 20 years: the grown lump sum + all the rent paid out. */
  readonly rentTotal20 = Math.round(this.plan.rentYearly * 20);
  readonly growth20 = Math.round(this.plan.finalValue);
  readonly worth20 = this.growth20 + this.rentTotal20;

  /** The milestone timeline (years → dots). */
  readonly years = [5, 10, 15, 20];

  buy(): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit('villa');
  }
  onBack(): void { this.back.emit(); }
}
