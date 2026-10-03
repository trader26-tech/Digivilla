import { Injectable, signal } from '@angular/core';

/** The app's name — the one place it is spelled out in code. */
export const APP_NAME = 'TheDigiCiti';
/** The name it had before, shown once in the "new name, new look" sheet. */
export const OLD_NAME = 'Digivilla';

// v2: the final launch icon (bigger villa, smaller coin) — show the sheet once more so iPhones re-add it
const SEEN_KEY = 'tdc_brand_seen_v2';

/** Where the app is running — decides how we explain getting the new icon. */
export type Platform = 'ios-app' | 'ios-browser' | 'android-app' | 'other';

/**
 * The "new name, new look" moment.
 *   • shown ONCE per device to a returning user (the first open after the update);
 *   • can be opened again from Settings (“Get the new app icon”).
 * An installed Android app picks up the new icon + name by itself (Chrome
 * re-reads the manifest); iPhone never changes an installed icon, so there
 * the sheet walks the user through re-adding it.
 */
@Injectable({ providedIn: 'root' })
export class BrandService {
  readonly open = signal(false);
  /** Chrome's install prompt, kept so the sheet can offer a real "Install" button. */
  readonly installEvent = signal<any>(null);

  constructor() {
    try {
      window.addEventListener('beforeinstallprompt', (e: Event) => { e.preventDefault(); this.installEvent.set(e); });
      window.addEventListener('appinstalled', () => this.installEvent.set(null));
    } catch { /* no window (tests) */ }
  }

  get seen(): boolean { try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; } }
  markSeen(): void { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} }

  /** Show it once for a returning user, a beat after the home has painted. */
  showOnce(delayMs = 900): void {
    if (this.seen) return;
    setTimeout(() => { if (!this.seen) this.open.set(true); }, delayMs);
  }
  show(): void { this.open.set(true); }
  close(): void { this.markSeen(); this.open.set(false); }

  platform(): Platform {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
    if (ios) return standalone ? 'ios-app' : 'ios-browser';
    if (/Android/i.test(ua) && standalone) return 'android-app';
    return 'other';
  }

  async install(): Promise<boolean> {
    const e = this.installEvent();
    if (!e) return false;
    e.prompt();
    const r = await e.userChoice.catch(() => null);
    this.installEvent.set(null);
    return r?.outcome === 'accepted';
  }
}
