import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { IntroComponent } from './intro.component';
import { StorefrontComponent } from './storefront.component';

/**
 * Shell. Plays the opening intro once, then reveals the PropertyNest
 * storefront — the four property tiers a customer can own.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IntroComponent, StorefrontComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** The opening animation plays first; flips false when it finishes. */
  intro = true;

  onIntroDone(): void {
    this.intro = false;
  }
}
