import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

import { WorldTodayComponent } from './world-today.component';

/** "World markets": every major market and our funds — open or closed, last update, on one chart. */
@Component({
  selector: 'app-markets-page',
  standalone: true,
  imports: [CommonModule, WorldTodayComponent],
  template: `<div class="mk"><app-world-today></app-world-today></div>`,
  styles: [`
    :host { display: block; background: var(--nw-bg); color: var(--nw-text); -webkit-font-smoothing: antialiased; }
    .mk { max-width: 1680px; margin: 0 auto; padding: 18px 32px 40px; animation: mkFade .25s ease both; }
    @keyframes mkFade { from { opacity: 0; } to { opacity: 1; } }
    @media (max-width: 900px) { .mk { padding: 12px 12px calc(28px + var(--tabbar-h, 0px)); } }
    @media (prefers-reduced-motion: reduce) { .mk { animation: none; } }
  `],
})
export class MarketsPageComponent {}
