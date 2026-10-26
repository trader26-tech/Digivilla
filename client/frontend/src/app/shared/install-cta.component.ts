import { CommonModule } from '@angular/common';
import { Component, Input, inject, signal } from '@angular/core';

import { InstallService } from './install.service';

/**
 * "Add to home screen" — one button, and the steps when the browser has no one-tap install.
 *   mode="card"   a full card (empty home, Settings): app mark · title · line · button
 *   mode="banner" a slim dismissible strip (top of the home while on the web)
 * Renders nothing once the app runs from the home screen.
 */
@Component({
  selector: 'app-install-cta',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.offerable && (mode !== 'banner' || !svc.dismissed())) {
      @if (mode === 'banner') {
        <div class="ib" role="region" aria-label="Get the app">
          <img class="ib-mark" src="icons/tdc2/mark-96.webp" alt="" width="28" height="28" />
          <span class="ib-t">Keep TheDigiCiti on your home screen</span>
          <button type="button" class="ib-go" (click)="go()">{{ busy() ? '…' : 'Add' }}</button>
          <button type="button" class="ib-x" (click)="svc.dismiss()" aria-label="Not now">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      } @else {
        <div class="ic">
          <img class="ic-mark" src="icons/tdc2/mark-96.webp" alt="" width="44" height="44" />
          <div class="ic-t">
            <b>Get the app on your phone</b>
            <span>Full screen, one tap from your home screen.</span>
          </div>
          <button type="button" class="ic-go" (click)="go()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ busy() ? 'Opening…' : 'Add' }}
          </button>
        </div>
      }

      <!-- the steps, when the browser can't install in one tap -->
      @if (steps()) {
        <div class="is-scrim" (click)="steps.set(false)" aria-hidden="true"></div>
        <section class="is" role="dialog" aria-modal="true" aria-labelledby="isTitle">
          <span class="is-grab" aria-hidden="true"></span>
          <img class="is-mark" src="icons/tdc2/mark-96.webp" alt="" width="56" height="56" />
          <h3 id="isTitle">Add TheDigiCiti to your home screen</h3>
          @if (svc.isIOS) {
            <ol>
              <li><i>1</i><span>Tap <b>Share</b> <svg class="ios-share" viewBox="0 0 24 24" aria-label="the share icon"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg> at the bottom of Safari</span></li>
              <li><i>2</i><span>Scroll and tap <b>Add to Home Screen</b></span></li>
              <li><i>3</i><span>Tap <b>Add</b> — the app appears next to your other apps</span></li>
            </ol>
            @if (!svc.isSafari) { <p class="is-note">On iPhone this works from Safari — open this page there first.</p> }
          } @else {
            <ol>
              <li><i>1</i><span>Tap the browser menu <b>⋮</b> (top right)</span></li>
              <li><i>2</i><span>Tap <b>Add to Home screen</b> (or <b>Install app</b>)</span></li>
              <li><i>3</i><span>Tap <b>Add</b> — the app appears on your home screen</span></li>
            </ol>
          }
          <button type="button" class="is-ok" (click)="steps.set(false)">Got it</button>
        </section>
      }
    }
  `,
  styles: [`
    :host { display: contents; }
    .ib { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; border-radius: 16px; background: rgba(30, 33, 48, .96); color: #e9e9ed;
      box-shadow: inset 0 0 0 1px #2b2e3a, 0 10px 30px -14px rgba(0, 0, 0, .7); font-family: Inter, system-ui, sans-serif; animation: ibIn .45s cubic-bezier(.22, 1, .36, 1) both; }
    @keyframes ibIn { from { opacity: 0; transform: translateY(-8px); } }
    .ib-mark { flex: none; width: 28px; height: 28px; border-radius: 8px; }
    .ib-t { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 500; line-height: 1.3; }
    .ib-go { flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: #efedfc; color: #2b2741; font: 500 13px Inter, system-ui, sans-serif; cursor: pointer; -webkit-tap-highlight-color: transparent; &:active { transform: scale(.96); } }
    .ib-x { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 50%; background: none; color: #75798c; cursor: pointer; svg { width: 14px; height: 14px; } }

    .ic { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 14px 14px 16px; border-radius: 16px; background: #1e2130; color: #e9e9ed;
      box-shadow: inset 0 0 0 1px #2b2e3a; font-family: Inter, system-ui, sans-serif; text-align: left; }
    .ic-mark { flex: none; width: 44px; height: 44px; border-radius: 12px; box-shadow: 0 8px 20px -10px rgba(145, 132, 217, .8); }
    .ic-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; b { font-size: 14.5px; font-weight: 500; } span { font-size: 12px; color: #9a9aa5; } }
    .ic-go { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 16px; border: 0; border-radius: 999px; background: #efedfc; color: #2b2741;
      font: 500 13.5px Inter, system-ui, sans-serif; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: transform .15s;
      svg { width: 16px; height: 16px; } &:active { transform: scale(.96); } }

    .is-scrim { position: fixed; inset: 0; z-index: 120; background: rgba(8, 9, 16, .6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
    .is { position: fixed; z-index: 121; left: 0; right: 0; bottom: 0; margin: 0 auto; max-width: 480px; padding: 8px 22px calc(22px + env(safe-area-inset-bottom)); border-radius: 26px 26px 0 0;
      background: linear-gradient(180deg, #1f2233, #191b28); color: #e9e9ed; font-family: Inter, system-ui, sans-serif; box-shadow: 0 -24px 60px -20px rgba(0, 0, 0, .7);
      display: flex; flex-direction: column; align-items: center; animation: isUp .36s cubic-bezier(.2, .9, .25, 1.04) both; }
    @keyframes isUp { from { transform: translateY(100%); } }
    .is-grab { width: 38px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .18); margin-bottom: 18px; }
    .is-mark { width: 56px; height: 56px; border-radius: 16px; box-shadow: 0 14px 30px -12px rgba(145, 132, 217, .9); }
    .is h3 { margin: 14px 0 16px; font-size: 18px; font-weight: 500; letter-spacing: -.01em; text-align: center; }
    .is ol { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; gap: 10px; }
    .is li { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, .04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .06); font-size: 14px; line-height: 1.4;
      i { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #2b2741; color: #b5abfc; font: 500 12px Inter, system-ui, sans-serif; font-style: normal; }
      b { font-weight: 500; color: #efedfc; } }
    .ios-share { width: 16px; height: 16px; vertical-align: -3px; color: #b5abfc; margin: 0 2px; }
    .is-note { margin: 10px 0 0; font-size: 12px; color: #9a9aa5; text-align: center; }
    .is-ok { margin-top: 18px; width: 100%; height: 46px; border: 0; border-radius: 14px; background: #efedfc; color: #2b2741; font: 500 15px Inter, system-ui, sans-serif; cursor: pointer; }
    @media (prefers-reduced-motion: reduce) { .ib, .is { animation: none; } }
  `],
})
export class InstallCtaComponent {
  readonly svc = inject(InstallService);
  @Input() mode: 'card' | 'banner' = 'card';
  readonly steps = signal(false);
  readonly busy = signal(false);

  async go(): Promise<void> {
    if (this.svc.oneTap) {
      this.busy.set(true);
      const ok = await this.svc.install();
      this.busy.set(false);
      if (!ok && this.svc.prompt() == null && !this.svc.installed()) this.steps.set(true);   // the dialog went away without a yes — show the steps
      return;
    }
    this.steps.set(true);
  }
}
