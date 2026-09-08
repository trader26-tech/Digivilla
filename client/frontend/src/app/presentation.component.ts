import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output, ViewChild, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * In-app presentation — the "₹1 crore, two ways" deck rendered INSIDE the app
 * (not a new tab), with our own left/right controls.
 *
 * The deck is a same-origin page of 13 stacked `<section class="slide">`
 * elements. We load it in an iframe, hide its own scrollbars/chrome, and drive
 * navigation ourselves: our arrow buttons scroll the target slide into view,
 * and a dot rail shows progress. This gives a clean, native-feeling slideshow
 * the advisor controls with one thumb.
 *
 * On a phone held upright the stage is rotated 90° so the horizontal deck fills
 * the screen in landscape.
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
  @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;

  readonly rawUrl = 'deck/flat-vs-income.html';
  deckUrl: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {
    this.deckUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl);
  }

  portrait = signal(true);
  loaded = signal(false);
  stalled = signal(false);

  /** Slide index + total, driven from the deck's own <section.slide> list. */
  index = signal(0);
  total = signal(0);

  private slides: HTMLElement[] = [];
  private watchdog?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.measure();
    this.tryLockLandscape();
    this.watchdog = setTimeout(() => { if (!this.loaded()) this.stalled.set(true); }, 7000);
  }

  ngOnDestroy(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.tryUnlock();
  }

  /** Once the deck loads, grab its slides, hide its own chrome, and show the
   *  first slide. The deck shows one slide at a time via opacity/visibility —
   *  we drive that directly so our controls page cleanly through them. */
  onFrameLoad(): void {
    const doc = this.frameDoc();
    if (!doc) { this.stalled.set(true); return; }
    const collect = () => {
      const list = Array.from(doc.querySelectorAll<HTMLElement>('section.slide'));
      if (!list.length) return false;
      this.slides = list;
      this.total.set(list.length);
      this.injectDeckStyles(doc);
      this.goTo(0);
      this.loaded.set(true);
      this.stalled.set(false);
      if (this.watchdog) clearTimeout(this.watchdog);
      return true;
    };
    if (!collect()) {
      let tries = 0;
      const iv = setInterval(() => { if (collect() || ++tries > 25) clearInterval(iv); }, 200);
    }
  }

  /** Hide the deck's own presenter chrome (the left thumbnail rail + any
   *  scrollbars) and centre each slide so it fills our stage. */
  private injectDeckStyles(doc: Document): void {
    try {
      const style = doc.createElement('style');
      style.id = '__pres_override';
      style.textContent = `
        html, body { overflow: hidden !important; margin: 0 !important; background: #faf9f5 !important; }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        /* The thumbnail rail sits to the LEFT of the stage (x < ~188px). Hide any
           aside/nav chrome so only the current slide shows. */
        aside, nav, [class*="rail"], [class*="thumb"], [class*="sidebar"],
        [class*="filmstrip"], [class*="tray"] { display: none !important; }
        /* Centre each absolute slide in the viewport, filling it. */
        section.slide {
          position: fixed !important; inset: 0 !important; margin: auto !important;
          transition: opacity 0.32s ease !important;
        }
      `;
      doc.head.appendChild(style);
    } catch { /* same-origin, shouldn't throw */ }
  }

  private frameDoc(): Document | null {
    try { return this.frame?.nativeElement.contentDocument || null; } catch { return null; }
  }

  // ── navigation: drive the deck's own one-slide-visible model ──
  next(): void { this.goTo(this.index() + 1); }
  prev(): void { this.goTo(this.index() - 1); }

  goTo(i: number): void {
    const n = this.slides.length;
    if (!n) return;
    const clamped = Math.max(0, Math.min(n - 1, i));
    this.index.set(clamped);
    // show only the target slide (deck toggles opacity/visibility to page)
    this.slides.forEach((s, k) => {
      const on = k === clamped;
      s.style.setProperty('opacity', on ? '1' : '0', 'important');
      s.style.setProperty('visibility', on ? 'visible' : 'hidden', 'important');
      s.style.setProperty('z-index', on ? '2' : '0', 'important');
      s.style.setProperty('pointer-events', on ? 'auto' : 'none', 'important');
    });
    if (navigator.vibrate) navigator.vibrate(4);
  }

  get atStart(): boolean { return this.index() <= 0; }
  get atEnd(): boolean { return this.index() >= this.total() - 1; }

  /** Keyboard support on desktop. */
  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); this.next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.prev(); }
    else if (e.key === 'Escape') { this.doClose(); }
  }

  openInNewTab(): void { window.open(this.rawUrl, '_blank', 'noopener'); }

  @HostListener('window:resize')
  onResize(): void { this.measure(); }
  @HostListener('window:orientationchange')
  onOrient(): void { setTimeout(() => this.measure(), 120); }

  private measure(): void { this.portrait.set(window.innerHeight > window.innerWidth); }

  private async tryLockLandscape(): Promise<void> {
    try {
      const el = document.documentElement as any;
      if (el.requestFullscreen) { await el.requestFullscreen().catch(() => {}); }
      const orient: any = (screen as any).orientation;
      if (orient && orient.lock) { await orient.lock('landscape').catch(() => {}); }
    } catch { /* CSS rotation handles it */ }
  }
  private async tryUnlock(): Promise<void> {
    try {
      const orient: any = (screen as any).orientation;
      if (orient && orient.unlock) orient.unlock();
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    } catch { /* no-op */ }
  }

  doClose(): void { this.tryUnlock(); this.close.emit(); }
}
