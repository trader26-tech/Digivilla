import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { IntroComponent } from './intro.component';
import { LandDetailComponent, LandVariantKey } from './land-detail.component';
import { StorefrontComponent } from './storefront.component';

/**
 * Shell. Plays the opening intro once, then reveals the PropertyNest
 * storefront. Opening the Land tier swaps in its full detail page.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IntroComponent, StorefrontComponent, LandDetailComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  /** null = storefront; otherwise the Land detail page opened on this variant. */
  landVariant: LandVariantKey | null = null;

  onIntroDone(): void {
    this.intro = false;
  }

  openLand(variant: LandVariantKey): void {
    this.landVariant = variant;
    window.scrollTo({ top: 0 });
  }

  closeLand(): void {
    this.landVariant = null;
  }
}
