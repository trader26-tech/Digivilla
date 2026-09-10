import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

import { AccountComponent } from './account/account.component';
import { EstateLevelsComponent } from './estate-levels/estate-levels.component';
import { AuthService } from './auth/auth.service';
import { LoginComponent } from './auth/login.component';
import { BuildPickerComponent } from './build/build-picker.component';
import { ConstructionDetailComponent } from './construction/construction-detail.component';
import { EstateDetailComponent } from './estate-detail.component';
import { LandBuyComponent } from './build/land-buy.component';
import { VillaBuyComponent } from './build/villa-buy.component';
import { CallsComponent } from './calls.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent as LandStorefrontComponent } from './land-detail.component';
import { EstateHomeComponent } from './estate-home.component';
import { ExploreComponent } from './explore/explore.component';
import { FundsComponent } from './funds/funds.component';
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
    ExploreComponent,
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
    EstateLevelsComponent,
    FundsComponent,
    CallsComponent,
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

  /** True only on the login→app transition we just made, so the onboarding
   *  screen plays its "verified" tick once (not on every returning visit). */
  justVerified = false;

  private readonly swUpdate = inject(SwUpdate, { optional: true });

  constructor() {
    // On a returning verified session, sync the profile from the auth user.
    this.syncProfileFromAuth();
    // Deep-link support: ?view=explore opens the Explore tab on load.
    try {
      const v = new URLSearchParams(location.search).get('view');
      if (v === 'explore' || v === 'home' || v === 'calls' || v === 'funds') { this.view = v; this.intro = false; }
    } catch {}
    // Never leave a user stuck on a stale cached build: as soon as the service
    // worker fetches a newer version, activate it and reload so the latest app
    // (and the presentation deck) is what they see.
    this.watchForUpdates();
  }

  private watchForUpdates(): void {
    const sw = this.swUpdate;
    if (!sw || !sw.isEnabled) return;
    sw.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') {
        sw.activateUpdate().then(() => document.location.reload()).catch(() => {});
      }
    });
    // Proactively poll for a new version shortly after load and every 5 min.
    setTimeout(() => sw.checkForUpdate().catch(() => {}), 8000);
    setInterval(() => sw.checkForUpdate().catch(() => {}), 5 * 60_000);
  }

  /** Called after phone verification succeeds — the intro already played
   *  before login, so just reveal the app. */
  onLoggedIn(): void {
    this.justVerified = true;
    this.syncProfileFromAuth();
    // Load THIS user's real estate from the DB (empty for a new account),
    // replacing any leftover local cache from a previous/demo session.
    this.est.syncFromServer();
  }

  /** How many holdings the user has — decides which home to show:
   *  0 → onboarding (book setup call), 1 → single house, 2+ → the map grid. */
  get holdingCount(): number { return this.est.tiles().length; }

  /** From the onboarding "refresh" — the advisor may have assigned a villa, so
   *  re-pull the estate; if a villa now exists, the view flips automatically. */
  onEstateRefresh(): void { this.est.syncFromServer(); }

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

  /** Which bottom-nav tab is active. */
  view: 'home' | 'explore' | 'funds' | 'calls' | 'storefront' = 'home';

  /** True when a top-level tab (home/funds/calls) is showing — the bottom nav
   *  is only visible then, not on detail / buy / account pages. */
  get onTab(): boolean {
    return (
      !this.intro && this.auth.signedIn() &&
      this.detail === null && this.villa === null && this.land === null &&
      this.construction === null && this.buildFlow === null && !this.accountOpen &&
      !this.levelsOpen &&
      (this.view === 'home' || this.view === 'funds' || this.view === 'calls')
    );
  }

  goHome(): void {
    this.view = 'home';
    window.scrollTo({ top: 0 });
  }
  goExplore(): void {
    this.view = 'explore';
    window.scrollTo({ top: 0 });
  }
  goFunds(): void {
    this.view = 'funds';
    window.scrollTo({ top: 0 });
  }
  goCalls(): void {
    this.view = 'calls';
    window.scrollTo({ top: 0 });
  }

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

  /** The Estate Levels progression ladder is open. */
  levelsOpen = false;
  openLevels(): void {
    this.levelsOpen = true;
    window.scrollTo({ top: 0 });
  }
  closeLevels(): void {
    this.levelsOpen = false;
  }

  /** Log off from the account page — clears the session and returns home. */
  onSignOut(): void {
    this.auth.signOut();
    this.accountOpen = false;
  }

  onIntroDone(): void {
    this.intro = false;
  }

  /** "Build a new asset" -> go to the Explore tab, where villa/land are chosen. */
  openBuild(): void {
    this.view = 'explore';
    window.scrollTo({ top: 0 });
  }
  /** Ticket size chosen on the Explore villa feed. */
  buildAmount = 25_00_000;
  /** A villa tier tapped on the Explore feed -> the villa buy/SIP page,
   *  opened at the chosen ticket size. */
  pickBuild(amount: number): void {
    this.buildAmount = amount || 25_00_000;
    this.buildFlow = 'villa';
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

  /** "Own this villa" from Explore → go home, where the user books the setup
   *  call (the advisor assigns the villa). The advisor-led flow is the only way
   *  a villa is created, so we route them to the home's booking CTA. */
  ownVilla(_v: unknown): void {
    // Owning a villa is advisor-led: take the user to the Calls tab and pop the
    // scheduler open on the "Portfolio review" track so they book the setup call
    // and pick a real free slot from the fund manager's calendar.
    this.bookOnOpen = 'Portfolio review';
    this.view = 'calls';
    window.scrollTo({ top: 0 });
  }

  /** When set, the Calls tab auto-opens its scheduler on this reason. Consumed
   *  (cleared) by the Calls page once it has opened. */
  bookOnOpen: string | null = null;
  clearBookOnOpen(): void { this.bookOnOpen = null; }
}
