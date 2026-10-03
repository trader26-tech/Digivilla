import { Injectable, signal } from '@angular/core';

/** One line of the release notes. */
export interface ReleaseNote { title: string; body: string; }

/**
 * "What's new" — a plain list of what changed in the latest release, shown ONCE
 * per device to a returning (signed-in) user. Bump RELEASE when the notes change.
 */
const RELEASE = '2026-10-03';
const SEEN_KEY = `tdc_whats_new_${RELEASE}`;

@Injectable({ providedIn: 'root' })
export class WhatsNewService {
  readonly open = signal(false);
  readonly date = '3 Oct 2026';
  readonly notes: ReleaseNote[] = [
    { title: 'Digivilla is now TheDigiCiti',
      body: 'Only the name has changed. Your account, estate and investments are exactly as they were.' },
    { title: 'Calculators show results straight away',
      body: 'Numbers and charts appear as soon as you open a calculator — no extra tap.' },
    { title: 'Villa returns match everywhere',
      body: 'The calculators and “What does a villa represent?” now use the same figure: the last 15 years.' },
    { title: 'Swipe on Home',
      body: 'Swipe down to see your next villa. Swipe up to see what a villa represents.' },
  ];

  private get seen(): boolean { try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; } }
  markSeen(): void { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } }

  /** once for a returning user, a beat after Home has painted */
  showOnce(delayMs = 900): void {
    if (this.seen) return;
    setTimeout(() => { if (!this.seen) this.open.set(true); }, delayMs);
  }
  close(): void { this.markSeen(); this.open.set(false); }
}
