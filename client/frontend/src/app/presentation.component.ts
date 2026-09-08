import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output, signal } from '@angular/core';

/**
 * Full-screen presentation overlay — plays the "₹1 crore, two ways" deck for
 * the advisor to walk a client through, from their phone.
 *
 * The deck is a horizontal (landscape) slideshow. On a phone held upright we
 * rotate the stage 90° so it fills the screen in landscape without the user
 * having to physically turn the device — and we also *try* to lock the OS to
 * landscape (supported on Android/Chrome; iOS Safari ignores it, which is why
 * the CSS rotation is the real fix). Tapping the arrows inside the deck pages
 * through the slides.
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

  /** URL of the bundled deck served from /public. */
  readonly deckUrl = 'deck/flat-vs-income.html';

  /** True when the phone is in portrait and we should rotate the stage. */
  portrait = signal(true);
  /** Show the "rotate for the best view" hint briefly on open. */
  showHint = signal(true);

  ngOnInit(): void {
    this.measure();
    // Try to lock the device to landscape (Android/Chrome). Best-effort:
    // requires fullscreen first on some browsers, and iOS ignores it.
    this.tryLockLandscape();
    // fade the rotate hint away after a moment
    setTimeout(() => this.showHint.set(false), 3200);
  }

  ngOnDestroy(): void {
    this.tryUnlock();
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
