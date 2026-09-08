import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output, signal } from '@angular/core';

import { SLIDES, Slide } from './presentation/deck.data';

/**
 * In-app presentation — the "₹1 crore, two ways" deck rebuilt as NATIVE slides
 * (not an embedded page). 13 slides render with the deck's editorial identity
 * and are paged with our own left/right controls + a progress dot rail.
 *
 * On a phone held upright the stage rotates 90° so each 16:9 slide fills the
 * screen in landscape; we also try to lock the OS to landscape.
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

  readonly slides: Slide[] = SLIDES;
  index = signal(0);
  /** Direction of the last move, for the slide-in animation. */
  dir = signal<1 | -1>(1);
  portrait = signal(true);

  get total(): number { return this.slides.length; }
  get current(): Slide { return this.slides[this.index()]; }
  get atStart(): boolean { return this.index() <= 0; }
  get atEnd(): boolean { return this.index() >= this.total - 1; }

  ngOnInit(): void {
    this.measure();
    this.tryLockLandscape();
  }
  ngOnDestroy(): void { this.tryUnlock(); }

  next(): void { if (!this.atEnd) { this.dir.set(1); this.go(this.index() + 1); } }
  prev(): void { if (!this.atStart) { this.dir.set(-1); this.go(this.index() - 1); } }
  goTo(i: number): void {
    if (i === this.index()) return;
    this.dir.set(i > this.index() ? 1 : -1);
    this.go(i);
  }
  private go(i: number): void {
    this.index.set(Math.max(0, Math.min(this.total - 1, i)));
    if (navigator.vibrate) navigator.vibrate(4);
  }

  // keyboard (desktop) + swipe (touch)
  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (['ArrowRight', 'ArrowDown', ' '].includes(e.key)) { e.preventDefault(); this.next(); }
    else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); this.prev(); }
    else if (e.key === 'Escape') { this.doClose(); }
  }

  private sx: number | null = null;
  private sy: number | null = null;
  onDown(e: PointerEvent): void { this.sx = e.clientX; this.sy = e.clientY; }
  onUp(e: PointerEvent): void {
    if (this.sx === null || this.sy === null) return;
    const dx = e.clientX - this.sx, dy = e.clientY - this.sy;
    this.sx = this.sy = null;
    // In portrait the stage is rotated 90°, so a physical horizontal swipe reads
    // as vertical in stage coords — accept both axes and use the larger delta.
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const d = horiz ? dx : dy;
    if (Math.abs(d) < 45) return;
    if (d < 0) this.next(); else this.prev();
  }

  @HostListener('window:resize') onResize(): void { this.measure(); }
  @HostListener('window:orientationchange') onOrient(): void { setTimeout(() => this.measure(), 120); }
  private measure(): void { this.portrait.set(window.innerHeight > window.innerWidth); }

  private async tryLockLandscape(): Promise<void> {
    try {
      const el = document.documentElement as any;
      if (el.requestFullscreen) await el.requestFullscreen().catch(() => {});
      const o: any = (screen as any).orientation;
      if (o && o.lock) await o.lock('landscape').catch(() => {});
    } catch { /* CSS rotation handles it */ }
  }
  private async tryUnlock(): Promise<void> {
    try {
      const o: any = (screen as any).orientation;
      if (o && o.unlock) o.unlock();
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
    } catch { /* no-op */ }
  }

  doClose(): void { this.tryUnlock(); this.close.emit(); }
}
