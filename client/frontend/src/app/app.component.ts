import { CommonModule } from '@angular/common';
import { Component, HostListener, effect, inject, signal } from '@angular/core';
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
import { NextVillaComponent } from './build/next-villa.component';
import { CallsComponent } from './calls.component';
import { GoalsComponent } from './goals/goals.component';
import { InvestmentsComponent } from './invest/investments.component';
import { InstallService } from './shared/install.service';
import { GoalsService } from './goals/goals.service';
import { CalculatorsComponent } from './calc/calculators.component';
import { IntroComponent } from './intro.component';
import { LandDetailComponent as LandStorefrontComponent } from './land-detail.component';
import { EstateHomeComponent } from './estate-home.component';
import { ExploreComponent } from './explore/explore.component';
import { LandDetailComponent } from './land/land-detail.component';
import { PropertyKey } from './property-package.data';
import { StorefrontComponent } from './storefront.component';
import { WhatsNewComponent } from './shared/whats-new.component';
import { WhatsNewService } from './shared/whats-new.service';
import { EstateService, Tile } from './estate.service';

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
    GoalsComponent,
    InvestmentsComponent,
    CommonModule,
    IntroComponent,
    EstateHomeComponent,
    ExploreComponent,
    StorefrontComponent,
    LandStorefrontComponent,
    LandDetailComponent,
    EstateDetailComponent,
    ConstructionDetailComponent,
    BuildPickerComponent,
    VillaBuyComponent,
    NextVillaComponent,
    LandBuyComponent,
    AccountComponent,
    EstateLevelsComponent,
    CallsComponent,
    CalculatorsComponent,
    LoginComponent,
    WhatsNewComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly install = inject(InstallService);
  /** the Goals flow: its sub-pages hide the tab bar */
  private readonly goalsSvc = inject(GoalsService);
  readonly auth = inject(AuthService);
  private readonly est = inject(EstateService);
  readonly whatsNew = inject(WhatsNewService);

  /** The opening animation plays first; flips false when it finishes. */
  intro = true;
  /** Full cinematic intro only on the very first launch on this device. */
  readonly introFull = (() => { try { return !localStorage.getItem('intro_seen_v1'); } catch { return true; } })();
  /** Returning users: the quick intro ends as soon as the home can paint with
   *  real data (or immediately if signed out → login). */
  get introReady(): boolean {
    return !this.auth.signedIn() || (this.est.portfolioLoaded() && this.est.allocLoaded());
  }
  /** The home's code is its own chunk (so a first-time visitor's login arrives
   *  sooner); a signed-in open fetches it at once, and the welcome never fades
   *  out over a home that isn't there yet. */
  private readonly homeLoaded = signal(false);
  get introHold(): boolean { return this.auth.signedIn() && !this.homeLoaded(); }
  private loadHome(): void {
    const done = () => this.homeLoaded.set(true);
    import('./estate-home.component').then(done, done);
  }

  /** True only on the login→app transition we just made, so the onboarding
   *  screen plays its "verified" tick once (not on every returning visit). */
  justVerified = false;

  private readonly swUpdate = inject(SwUpdate, { optional: true });

  constructor() {
    this.install;   // created now, so the browser's install prompt is caught early
    // The admin's "open their app": ?viewas=<pass> → a read-only session as that client,
    // then reload without the pass in the address (so nothing is cached from the old session).
    try {
      const t = new URLSearchParams(location.search).get('viewas');
      if (t) {
        this.viewMsg = 'Opening the client’s app…';
        this.auth.viewAs(t).then(() => location.replace(location.pathname),
          (e) => { this.viewMsg = e?.message || 'This link has expired — open it again from the admin.'; history.replaceState(null, '', location.pathname); });
      }
    } catch {}
    // On a returning verified session, sync the profile from the auth user.
    this.syncProfileFromAuth();
    // Deep-link support: ?view=explore opens the Explore tab on load.
    try {
      const v = new URLSearchParams(location.search).get('view');
      if (v === 'explore' || v === 'home' || v === 'calls' || v === 'funds' || v === 'calc' || v === 'goals' || v === 'invest') { this.view = v; this.intro = false; }
    } catch {}
    // A returning user whose home figures are already in hand (EstateService
    // restored this NAV day's snapshot) skips the splash — the home is the
    // first frame. Otherwise the quick splash waits for the data as before.
    if (this.intro && !this.introFull && this.auth.signedIn() && this.introReady) this.intro = false;
    if (!this.intro) { this.endBootIntro(); this.showWhatsNew(); }
    // The home's code: now for a signed-in open, else quietly once the login is up.
    if (this.auth.signedIn()) this.loadHome();
    else setTimeout(() => this.loadHome(), 2500);
    // Never leave a user stuck on a stale cached build: as soon as the service
    // worker fetches a newer version, activate it and reload so the latest app
    // (and the presentation deck) is what they see.
    this.watchForUpdates();
    // Once the home has its data, quietly warm what the other tabs need
    // (Settings data + the Progress stage art) while the user looks at it,
    // so every tab opens instantly. Runs once per signed-in session.
    effect(() => {
      if (this.warmed || !this.auth.signedIn() || !this.est.portfolioLoaded()) return;
      this.warmed = true;
      const idle = (cb: () => void) =>
        ('requestIdleCallback' in window ? (window as any).requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 1200));
      idle(() => {
        this.est.prefetchSettings();
        for (const s of ['plot', 'grading', 'foundation', 'steel', 'villa']) {
          const img = new Image(); img.decoding = 'async'; img.src = `assets/levels/${s}.svg`;
        }
      });
    });
  }
  private warmed = false;

  /** No splash this open: drop index.html's welcome (it normally decided the
   *  same and is already hidden). */
  private endBootIntro(): void {
    (window as { __boot?: { leave(): void } }).__boot?.leave();
  }

  private watchForUpdates(): void {
    const sw = this.swUpdate;
    if (!sw || !sw.isEnabled) return;
    sw.versionUpdates.subscribe((e) => {
      if (e.type !== 'VERSION_READY') return;
      // Still on the splash → swap to the new build now (the user sees nothing).
      // Mid-use → never yank the screen; apply it the next time the app goes to
      // the background, so the next open is already the latest version.
      if (this.intro) {
        sw.activateUpdate().then(() => document.location.reload()).catch(() => {});
        return;
      }
      const onHide = () => {
        if (document.visibilityState !== 'hidden') return;
        document.removeEventListener('visibilitychange', onHide);
        sw.activateUpdate().then(() => document.location.reload()).catch(() => {});
      };
      document.addEventListener('visibilitychange', onHide);
    });
    // Proactively poll for a new version shortly after load and every 5 min.
    setTimeout(() => sw.checkForUpdate().catch(() => {}), 8000);
    setInterval(() => sw.checkForUpdate().catch(() => {}), 5 * 60_000);
  }

  /** Called after phone verification succeeds — the intro already played
   *  before login, so just reveal the app. */
  onLoggedIn(): void {
    this.justVerified = true;
    this.loadHome();
    // a fresh sign-in sees the current app — no release notes to catch up on
    this.whatsNew.markSeen();
    this.syncProfileFromAuth();
    // Load THIS user's real estate from the DB (empty for a new account),
    // replacing any leftover local cache from a previous/demo session.
    this.est.syncFromServer();
  }

  /** Home has played the "verified" tick — clear the flag (next tick, outside this
   *  change-detection pass) so coming back to Home from another tab doesn't replay it. */
  onVerifiedShown(): void { setTimeout(() => { this.justVerified = false; }); }

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

  /** shown while a ?viewas pass is being redeemed (or why it failed) */
  viewMsg = '';
  /** leave the admin's view of a client: drop that session and close the tab */
  exitView(): void { this.auth.signOut(); try { window.close(); } catch {} location.replace(location.pathname); }

  /** Which bottom-nav tab is active. */
  view: 'home' | 'explore' | 'funds' | 'calls' | 'calc' | 'goals' | 'invest' | 'storefront' = 'home';

  /** True when a top-level tab (home/funds/calls) is showing — the bottom nav
   *  is only visible then, not on detail / buy / account pages. */
  /** A calculator (not the Compare hub) is open: it takes the whole screen, no tab bar. */
  calcOpen = false;

  get onTab(): boolean {
    return (
      !this.intro && this.auth.signedIn() &&
      this.detail === null && this.villa === null && this.land === null &&
      this.construction === null && this.building === null && this.buildFlow === null &&
      !this.levelsOpen && !(this.view === 'calc' && this.calcOpen) && !(this.view === 'goals' && this.goalsSvc.page() !== 'hub') &&
      (this.view === 'home' || this.view === 'funds' || this.view === 'calls' || this.view === 'calc' || this.view === 'goals' || this.view === 'invest')
    );
  }

  /** True when the booking / calls flow is showing over the Settings tab
   *  (opened from the Settings → "Book a call" row). The Settings page itself
   *  is the default for the Settings tab; this flips to the old <app-calls>. */
  callsOpen = false;

  goHome(): void {
    this.view = 'home';
    this.leaveAccount();
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  goExplore(): void {
    this.view = 'explore';
    window.scrollTo({ top: 0 });
  }
  goFunds(): void {
    this.view = 'funds';
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  /** The Goals tab: what the villas pay for. */
  goGoals(): void {
    this.view = 'goals';
    this.leaveAccount();
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  /** The Calculators tab. */
  /** the Investments page: a tab, and where a tap on the home's value lands */
  goInvest(): void {
    this.view = 'invest';
    this.leaveAccount();
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  goCalc(): void {
    this.view = 'calc';
    this.leaveAccount();
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  /** The Settings tab: always lands on the Settings page (booking closed).
   *  Tapping Settings again while in the booking flow returns to Settings. */
  goCalls(): void {
    this.view = 'calls';
    this.callsOpen = false;
    window.scrollTo({ top: 0 });
  }
  /** Settings → "Book a call": open the existing booking / calls flow. */
  openBooking(): void {
    this.view = 'calls';
    this.callsOpen = true;
    this.bookOnOpen = 'Portfolio review';
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

  /** The building/villa tile whose returns detail page is open, or null. Both
   *  villa AND building tiles route here now (the returns page). */
  building: Tile | null = null;

  /** Build flow: 'pick' shows the chooser, 'villa'/'land' the buy pages. */
  buildFlow: 'pick' | 'villa' | 'land' | 'next' | null = null;

  /** The account page is open. */
  accountOpen = false;

  /** Settings opens from the home avatar. It sits in the phone's history, so the
   *  system back gesture / button closes it; the tab bar stays, and Home leaves it. */
  openAccount(): void {
    this.accountOpen = true;
    window.scrollTo({ top: 0 });
    try { history.pushState({ dvAccount: 1 }, ''); } catch { /* ignore */ }
  }
  closeAccount(): void {
    if (!this.accountOpen) return;
    try { if (history.state?.dvAccount) { history.back(); return; } } catch { /* fall through */ }
    this.accountOpen = false;
  }
  /** a tab tap while Settings is open: drop Settings (and its history entry) without a back-jump */
  private leaveAccount(): void {
    if (!this.accountOpen) return;
    this.accountOpen = false;
    try { if (history.state?.dvAccount) history.replaceState(null, ''); } catch { /* ignore */ }
  }
  @HostListener('window:popstate')
  onPop(): void { if (this.accountOpen) { this.accountOpen = false; window.scrollTo({ top: 0 }); } }

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
    this.est.clearSessionCache();
    this.warmed = false;
    this.accountOpen = false;
  }

  onIntroDone(): void {
    this.intro = false;
    try { localStorage.setItem('intro_seen_v1', '1'); } catch {}
    this.showWhatsNew();
  }

  /** A returning user's first open after a release: the plain "What's new" list, once. */
  private showWhatsNew(): void {
    if (this.auth.viewing()) return;                // the admin viewing a client: no release notes
    if (this.auth.signedIn()) this.whatsNew.showOnce();
  }

  /** "Build a new asset" -> go to the Explore tab, where villa/land are chosen. */
  openBuild(): void {
    this.view = 'explore';
    window.scrollTo({ top: 0 });
  }
  /** The "+" on the home board -> the what-if page for the client's own estate. */
  openNext(): void {
    this.buildFlow = 'next';
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
    if (t.type === 'land') {
      this.land = t;
      window.scrollTo({ top: 0 });
      return;
    }
    // villa OR building → the returns detail page (fed by /me/building/{id})
    this.building = t;
    window.scrollTo({ top: 0 });
  }

  /** "View full details" from the Progress ladder → open the same villa report
   *  page the home board parcels open (fed by GET /me/building/villa_<idx>). */
  viewVilla(e: { idx: number; label: string }): void {
    this.building = {
      id: `villa_${e.idx}`, type: 'villa', variant: 'balanced',
      cost: 0, sipMonthly: 0, sipAccrued: 0, rentMonthly: 0,
      boughtAt: Date.now(), label: e.label,
    };
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

  closeBuilding(): void {
    this.building = null;
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
