import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { EstateService, Tile } from '../estate.service';
import { OnboardingHomeComponent } from '../onboarding/onboarding-home.component';
import { SingleEstateComponent } from '../single-estate/single-estate.component';
import { EstateHomeComponent } from '../estate-home.component';

/** The three life-stages of a client, all shown on ONE homescreen with the
 *  same shell. The stage is chosen automatically from real data:
 *   1 'call'  — no villa yet → book / see the setup call.
 *   2 'sip'   — one villa still building → watch the SIP fill it up.
 *   3 'villa' — a built villa, or two+ holdings → the villa/estate itself. */
export type HomeStage = 'call' | 'sip' | 'villa';

/**
 * The client homescreen — a single, evolving surface. It keeps a shared frame
 * (greeting, avatar, a 3-step progress rail) and swaps the body between three
 * templates as the account grows, so the app feels like one home that matures
 * rather than three separate screens.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, OnboardingHomeComponent, SingleEstateComponent, EstateHomeComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  /** Play the verified-tick once (passed to the call stage after OTP). */
  @Input() justVerified = false;

  @Output() openTile = new EventEmitter<Tile>();
  @Output() account = new EventEmitter<void>();
  @Output() explore = new EventEmitter<void>();
  @Output() build = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  private auth = inject(AuthService);
  readonly est = inject(EstateService);

  /** The current stage, derived from what the user actually holds. */
  readonly stage = computed<HomeStage>(() => {
    const tiles = this.est.tiles();
    if (tiles.length >= 2) return 'villa';           // an estate → the map
    if (tiles.length === 1) {
      return tiles[0].type === 'villa' ? 'villa' : 'sip';  // built vs building
    }
    return 'call';                                   // nothing yet → the call
  });

  /** The 3 steps shown on the shared rail, with the active one highlighted. */
  readonly STEPS: { key: HomeStage; label: string }[] = [
    { key: 'call', label: 'Setup call' },
    { key: 'sip', label: 'Build up' },
    { key: 'villa', label: 'Your villa' },
  ];
  /** 0-based index of the active step, for the rail fill. */
  readonly stepIndex = computed<number>(() =>
    this.STEPS.findIndex((s) => s.key === this.stage()));

  isDone(i: number): boolean { return i < this.stepIndex(); }
  isActive(i: number): boolean { return i === this.stepIndex(); }

  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  get name(): string { return (this.auth.user()?.name || this.est.profile().name || '').trim(); }
  get photo(): string | undefined { return this.est.profile().photo; }
  get initial(): string { return (this.name || 'D')[0].toUpperCase(); }
}
