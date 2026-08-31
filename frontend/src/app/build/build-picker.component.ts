import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { LandArtComponent } from '../shared/land-art.component';
import { VillaArtComponent } from '../shared/villa-art.component';

/**
 * Build a new asset → the pick screen. Two choices, villa or land, each shown
 * with its real map art. Picking one emits which product page to open.
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

  choose(kind: 'villa' | 'land'): void {
    if (navigator.vibrate) navigator.vibrate(5);
    this.pick.emit(kind);
  }
  onBack(): void { this.back.emit(); }
}
