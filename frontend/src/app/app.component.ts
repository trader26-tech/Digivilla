import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { AccountComponent } from './account/account.component';
import { AuthService } from './auth/auth.service';
import { LoginComponent } from './auth/login.component';
import { BuildPickerComponent } from './build/build-picker.component';
import { ConstructionDetailComponent } from './construction/construction-detail.component';
import { EstateDetailComponent } from './estate-detail.component';
import { LandBuyComponent } from './build/land-buy.component';
import { VillaBuyComponent } from './build/villa-buy.component';
import { EstateHomeComponent } from './estate-home.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent as LandStorefrontComponent } from './land-detail.component';
import { LandDetailComponent } from './land/land-detail.component';
import { PropertyKey } from './property-package.data';
import { StorefrontComponent } from './storefront.component';
import { EstateService, Tile } from './estate.service';
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
    LandStorefrontComponent,
    LandDetailComponent,
    EstateDetailComponent,
    VillaDetailComponent,
    ConstructionDetailComponent,
    BuildPickerComponent,
    VillaBuyComponent,
    LandBuyComponent,
    AccountComponent,
    LoginComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly est = inject(EstateService);

  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  constructor() {
    // On a returning verified session, sync the profile from the auth user.
    this.syncProfileFromAuth();
  }

  /** Called after phone verification succeeds — the intro already played
   *  before login, so just reveal the app. */
  onLoggedIn(): void {
    this.syncProfileFromAuth();
  }

  /** Mirror the verified user's name + phone into the estate profile so the
   *  account page and greeting show the real, logged-in details. */
  private syncProfileFromAuth(): void {
    const u = this.auth.user();
    if (!u) return;
    const patch: { name?: string; phone?: string } = {};
    if (u.name) patch.name = u.name;
    if (u.phone) patch.phone = u.phone;
    if (Object.keys(patch).length) this.est.setProfile(patch);
  }

  /** Which top-level view is showing under the home. */
  view: 'home' | 'storefront' = 'home';

  /** null = no detail; otherwise the detail page for this property + variant. */
  detail: { property: PropertyKey; variant: RiskVariant } | null = null;

  /** The villa whose dedicated detail page is open, or null. */
  villa: Tile | null = null;

  /** The land plot whose dedicated detail page is open, or null. */
  land: Tile | null = null;

  /** The under-construction tile whose detail page is open, or null. */
  construction: Tile | null = null;

  /** Build flow: 'pick' shows the chooser, 'villa'/'land' the buy pages. */
  buildFlow: 'pick' | 'villa' | 'land' | null = null;

  /** The account page is open. */
  accountOpen = false;

  openAccount(): void {
    this.accountOpen = true;
    window.scrollTo({ top: 0 });
  }
  closeAccount(): void {
    this.accountOpen = false;
  }

  onIntroDone(): void {
    this.intro = false;
  }

  /** "Build a new asset" -> open the pick screen. */
  openBuild(): void {
    this.buildFlow = 'pick';
    window.scrollTo({ top: 0 });
  }
  /** A choice on the pick screen -> the matching buy page. */
  pickBuild(kind: 'villa' | 'land'): void {
    this.buildFlow = kind;
    window.scrollTo({ top: 0 });
  }
  closeBuild(): void {
    this.buildFlow = null;
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
    // building → the dedicated under-construction detail page
    this.construction = t;
    window.scrollTo({ top: 0 });
  }

  closeVilla(): void {
    this.villa = null;
  }

  closeLand(): void {
    this.land = null;
  }

  closeConstruction(): void {
    this.construction = null;
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
