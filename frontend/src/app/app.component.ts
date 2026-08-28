import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { EstateDetailComponent } from './estate-detail.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent } from './land-detail.component';
import { PropertyKey } from './property-package.data';
import { StorefrontComponent } from './storefront.component';

type RiskVariant = 'conservative' | 'balanced' | 'aggressive';

/**
 * Shell. Plays the opening intro once, then reveals the PropertyNest
 * storefront. Tapping a tier swaps in its detail page — Land keeps its own
 * dedicated page; Flat/Apartment/Duplex use the income-tier estate-detail page.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IntroComponent, StorefrontComponent, LandDetailComponent, EstateDetailComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  /** null = storefront; otherwise the detail page for this property + variant. */
  detail: { property: PropertyKey; variant: RiskVariant } | null = null;

  onIntroDone(): void {
    this.intro = false;
  }

  openProperty(e: { property: PropertyKey; variant: RiskVariant }): void {
    this.detail = e;
    window.scrollTo({ top: 0 });
  }

  closeDetail(): void {
    this.detail = null;
  }
}
