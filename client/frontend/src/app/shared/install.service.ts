import { Injectable, signal } from '@angular/core';

/** Chrome's deferred install prompt (not in lib.dom). index.html parks it on window.__bip. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global { interface Window { __bip?: BeforeInstallPromptEvent | null; } }

const DISMISS_KEY = 'tdc.install.dismissed';   // ISO date of the last "not now"

/**
 * "Add to home screen": the web app installing itself as an app.
 *   · Android Chrome / Edge / Samsung: the browser hands us a prompt (beforeinstallprompt);
 *     index.html catches it before the app boots and we call prompt() from a tap.
 *   · iPhone / iPad: Safari has no prompt — we show the two steps (Share → Add to Home Screen).
 *   · Already installed (standalone): nothing to offer.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  /** the app is already running from the home screen */
  readonly standalone = signal(this.isStandalone());
  /** the browser offered a one-tap install */
  readonly prompt = signal<BeforeInstallPromptEvent | null>(window.__bip ?? null);
  /** the user said "not now" within the last week */
  readonly dismissed = signal(this.recentlyDismissed());
  readonly installed = signal(false);

  readonly ua = navigator.userAgent;
  readonly isIOS = /iPhone|iPad|iPod/.test(this.ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  readonly isAndroid = /Android/.test(this.ua);
  readonly isSafari = this.isIOS && /Safari/.test(this.ua) && !/CriOS|FxiOS|EdgiOS/.test(this.ua);

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.prompt.set(e as BeforeInstallPromptEvent); });
    window.addEventListener('appinstalled', () => { this.installed.set(true); this.prompt.set(null); });
    try { window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => this.standalone.set(e.matches)); } catch { /* old browsers */ }
  }

  /** worth showing an "add to home screen" button at all */
  get offerable(): boolean { return !this.standalone() && !this.installed() && (this.isIOS || this.isAndroid || !!this.prompt()); }
  /** one tap installs (Android with the browser's prompt); otherwise we show steps */
  get oneTap(): boolean { return !!this.prompt(); }

  /** Android: open the browser's install dialog. Resolves true when the user accepted. */
  async install(): Promise<boolean> {
    const p = this.prompt(); if (!p) return false;
    try {
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === 'accepted') { this.installed.set(true); }
      this.prompt.set(null); window.__bip = null;
      return outcome === 'accepted';
    } catch { return false; }
  }
  dismiss(): void { this.dismissed.set(true); try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* private mode */ } }

  private isStandalone(): boolean {
    try { return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true; } catch { return false; }
  }
  private recentlyDismissed(): boolean {
    try { const d = localStorage.getItem(DISMISS_KEY); return !!d && Date.now() - Date.parse(d) < 7 * 86_400_000; } catch { return false; }
  }
}
