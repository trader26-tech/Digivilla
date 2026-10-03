import { Component, HostListener, inject } from '@angular/core';

import { WhatsNewService } from './whats-new.service';

/** The release notes as a plain bottom sheet: a title, the date, a short list, "Got it". */
@Component({
  selector: 'app-whats-new',
  standalone: true,
  template: `
    <div class="wn-dim" (click)="wn.close()"></div>
    <section class="wn" role="dialog" aria-modal="true" aria-labelledby="wn-t">
      <header>
        <h2 id="wn-t">What's new</h2>
        <span>{{ wn.date }}</span>
      </header>
      <ul>
        @for (n of wn.notes; track n.title) {
          <li><b>{{ n.title }}</b><p>{{ n.body }}</p></li>
        }
      </ul>
      <button type="button" (click)="wn.close()">Got it</button>
    </section>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; justify-content: center; }
    .wn-dim { position: absolute; inset: 0; background: rgba(8, 9, 14, .6); animation: fade .2s ease both; }
    .wn {
      position: relative; width: 100%; max-width: 480px; box-sizing: border-box;
      padding: 22px 20px calc(18px + env(safe-area-inset-bottom));
      border-radius: 20px 20px 0 0; background: #1b1e2b; box-shadow: inset 0 1px 0 #34374a;
      color: #e9e9ed; font-family: var(--font-body, Inter, sans-serif); animation: up .26s ease-out both;
    }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    h2 { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -.01em; }
    header span { font-size: 12px; color: #8a8ea3; }
    ul { margin: 14px 0 18px; padding: 0; list-style: none; }
    li { padding: 12px 0; border-top: 1px solid #2c2f3e; }
    li:first-child { border-top: 0; }
    b { display: block; font-size: 14px; font-weight: 600; color: #eef0f6; }
    p { margin: 3px 0 0; font-size: 13px; line-height: 1.45; color: #a3a7ba; }
    button {
      width: 100%; height: 46px; border: 0; border-radius: 12px; cursor: pointer;
      font: 600 14.5px var(--font-body, Inter, sans-serif); color: #fff; background: #6f62d8;
    }
    button:active { transform: scale(.985); }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .wn, .wn-dim { animation: none; } }
  `],
})
export class WhatsNewComponent {
  readonly wn = inject(WhatsNewService);
  @HostListener('document:keydown.escape') esc(): void { this.wn.close(); }
}
