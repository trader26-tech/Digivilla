import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Full-screen presentation overlay — plays the "₹1 crore, two ways" deck for
 * the advisor to walk a client through, from their phone.
 *
 * The deck is a self-contained HTML slideshow served from /deck. It renders in
 * an iframe. Two robustness measures matter here:
 *   1. A cache-busting query so a stale service-worker copy is never shown.
 *   2. A load watchdog: if the iframe hasn't signalled load in a few seconds
 *      (blank screen), we surface an "Open in a new tab" escape hatch that
 *      opens the deck standalone — which always works.
 *
 * The deck is horizontal. On a phone held upright we rotate the stage 90° so it
 * fills the screen in landscape, and also try to lock the OS to landscape
 * (Android/Chrome; iOS ignores it, which is why the CSS rotation is the real fix).
 */
@Component({
  selector: 'app-presentation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation.component.html',
  styleUrl: './presentation.component.scss',
})
export class PresentationComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();

  /** URL of the bundled deck. The service worker caches it per build and the
   *  app auto-activates new builds, so this stays fresh without a query bust
   *  (which would defeat offline caching). */
  readonly rawUrl = 'deck/flat-vs-income.html';
  /** Sanitized URL for the iframe [src] (set in the constructor). */
  deckUrl: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {
    this.deckUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl);
  }

  /** True when the phone is in portrait and we should rotate the stage. */
  portrait = signal(true);
  /** Show the "rotate for the best view" hint briefly on open. */
  showHint = signal(true);
  /** The iframe fired its load event — the deck HTML arrived. */
  loaded = signal(false);
  /** Watchdog tripped: took too long, show the "open in new tab" escape hatch. */
  stalled = signal(false);

  private watchdog?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.measure();
    this.tryLockLandscape();
    setTimeout(() => this.showHint.set(false), 3200);
    // If the deck hasn't loaded in 6s, offer the standalone escape hatch.
    this.watchdog = setTimeout(() => {
      if (!this.loaded()) this.stalled.set(true);
    }, 6000);
  }

  ngOnDestroy(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.tryUnlock();
  }

  onFrameLoad(): void {
    this.loaded.set(true);
    this.stalled.set(false);
    if (this.watchdog) clearTimeout(this.watchdog);
  }

  /** Open the deck standalone in a new tab — the guaranteed-to-work fallback. */
  openInNewTab(): void {
    window.open(this.rawUrl, '_blank', 'noopener');
  }

  @HostListener('window:resize')
  onResize(): void { this.measure(); }

  @HostListener('window:orientationchange')
  onOrient(): void { setTimeout(() => this.measure(), 120); }

  private measure(): void {
    this.portrait.set(window.innerHeight > window.innerWidth);
  }

  private async tryLockLandscape(): Promise<void> {
    try {
      const el = document.documentElement as any;
      if (el.requestFullscreen) { await el.requestFullscreen().catch(() => {}); }
      const orient: any = (screen as any).orientation;
      if (orient && orient.lock) { await orient.lock('landscape').catch(() => {}); }
    } catch { /* unsupported — CSS rotation handles it */ }
  }
  private async tryUnlock(): Promise<void> {
    try {
      const orient: any = (screen as any).orientation;
      if (orient && orient.unlock) orient.unlock();
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    } catch { /* no-op */ }
  }

  doClose(): void {
    this.tryUnlock();
    this.close.emit();
  }
}
