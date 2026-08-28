import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { EstateDetailComponent } from './estate-detail.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent } from './land-detail.component';
import { PropertyKey } from './property-package.data';
import { RiskMapComponent } from './risk-map.component';
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
  imports: [CommonModule, IntroComponent, StorefrontComponent, LandDetailComponent, EstateDetailComponent, RiskMapComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  /** null = storefront; otherwise the detail page for this property + variant. */
  detail: { property: PropertyKey; variant: RiskVariant } | null = null;

  /** true = show the full risk × reward map (opened from the storefront preview). */
  showMap = false;

  onIntroDone(): void {
    this.intro = false;
  }

  openProperty(e: { property: PropertyKey; variant: RiskVariant }): void {
    this.detail = e;
    this.showMap = false;
    window.scrollTo({ top: 0 });
  }

  closeDetail(): void {
    this.detail = null;
  }

  /** Open the full risk × reward map from the storefront preview. */
  openMap(): void {
    this.showMap = true;
    window.scrollTo({ top: 0 });
  }

  closeMap(): void {
    this.showMap = false;
  }

  /** From the map, a tap on a scheme opens that property's detail page. */
  openFromMap(e: { property: PropertyKey; variant: RiskVariant }): void {
    this.showMap = false;
    this.detail = e;
    window.scrollTo({ top: 0 });
  }
}
