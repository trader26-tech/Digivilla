import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { IntroComponent } from './intro.component';

/**
 * Clean-slate shell. Plays the opening intro animation once, then shows a
 * blank black background. The whole UI is being rebuilt from scratch — nothing
 * else lives here yet.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, IntroComponent],
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
