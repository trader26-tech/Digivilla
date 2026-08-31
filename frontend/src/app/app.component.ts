import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { EstateDetailComponent } from './estate-detail.component';
import { EstateHomeComponent } from './estate-home.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent as LandBuyComponent } from './land-detail.component';
import { LandDetailComponent } from './land/land-detail.component';
import { PropertyKey } from './property-package.data';
import { StorefrontComponent } from './storefront.component';
import { Tile } from './estate.service';
import { VillaDetailComponent } from './villa/villa-detail.component';

type RiskVariant = 'conservative' | 'balanced' | 'aggressive';

/**
 * Shell. Plays the opening intro once, then reveals the isometric ESTATE HOME
 * — the user's personal map of what they own. Tapping a built tile opens its
 * detail page; the Explore tab opens the storefront to browse/buy more tiers.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    IntroComponent,
    EstateHomeComponent,
    StorefrontComponent,
    LandBuyComponent,
    LandDetailComponent,
    EstateDetailComponent,
    VillaDetailComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  /** Which top-level view is showing under the home. */
  view: 'home' | 'storefront' = 'home';

  /** null = no detail; otherwise the detail page for this property + variant. */
  detail: { property: PropertyKey; variant: RiskVariant } | null = null;

  /** The villa whose dedicated detail page is open, or null. */
  villa: Tile | null = null;

  /** The land plot whose dedicated detail page is open, or null. */
  land: Tile | null = null;

  onIntroDone(): void {
    this.intro = false;
  }

  /** A built tile on the estate was tapped -> open its detail page.
   *  villa -> the dedicated villa page; land -> land page; building -> estate. */
  openTile(t: Tile): void {
    if (t.type === 'villa') {
      this.villa = t;
      window.scrollTo({ top: 0 });
      return;
    }
    if (t.type === 'land') {
      this.land = t;
      window.scrollTo({ top: 0 });
      return;
    }
    this.detail = { property: 'flat', variant: t.variant };
    window.scrollTo({ top: 0 });
  }

  closeVilla(): void {
    this.villa = null;
  }

  closeLand(): void {
    this.land = null;
  }

  /** Explore tab -> the storefront catalog to browse tiers. */
  openStorefront(): void {
    this.view = 'storefront';
    window.scrollTo({ top: 0 });
  }

  openProperty(e: { property: PropertyKey; variant: RiskVariant }): void {
    this.detail = e;
    window.scrollTo({ top: 0 });
  }

  closeDetail(): void {
    this.detail = null;
  }

  /** Back from the storefront -> home. */
  backToHome(): void {
    this.view = 'home';
  }
}
