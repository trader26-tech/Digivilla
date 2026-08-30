/**
 * Pan / pinch / wheel handling for the estate map.
 *
 * Owns only the interaction state, and talks to the outside world through a
 * small port: it reads and writes the scroll position and the zoom level, and
 * reports whether the last pointer sequence was a gesture (so a drag doesn't
 * fire a tile tap). Keeping this out of the component makes both testable.
 */

export interface MapViewport {
  /** The scrolling element, or undefined before the view initialises. */
  element(): HTMLDivElement | undefined;
  zoom(): number;
  setZoom(z: number): void;
  minZoom: number;
  maxZoom: number;
  /** False when the board fits entirely — gestures are then inert. */
  enabled(): boolean;
}

export class MapGestures {
  constructor(private readonly view: MapViewport) {}

  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private startX = 0;
  private startY = 0;
  private startScrollX = 0;
  private startScrollY = 0;
  private panning = false;
  private moved = false;

  /** True when the last pointer sequence was a pan or pinch rather than a tap. */
  get wasGesture(): boolean {
    return this.moved;
  }

  // ------------------------------------------------------------- zooming ---

  /** Scale by `factor`, keeping the viewport centre anchored. */
  zoomBy(factor: number): void {
    if (!this.view.enabled()) return;
    const before = this.view.zoom();
    const after = clamp(+(before * factor).toFixed(3), this.view.minZoom, this.view.maxZoom);
    if (after === before) return;

    const el = this.view.element();
    if (!el) {
      this.view.setZoom(after);
      return;
    }
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    const k = after / before;
    this.view.setZoom(after);
    requestAnimationFrame(() => {
      el.scrollLeft = cx * k - el.clientWidth / 2;
      el.scrollTop = cy * k - el.clientHeight / 2;
    });
  }

  // -------------------------------------------------------------- touch ----

  onTouchStart(ev: TouchEvent): void {
    const el = this.view.element();
    if (!el) return;

    if (ev.touches.length === 2) {
      this.pinchStartDist = pinchDistance(ev.touches);
      this.pinchStartZoom = this.view.zoom();
      this.panning = false;
      this.moved = true;
    } else if (ev.touches.length === 1) {
      this.beginPan(ev.touches[0].clientX, ev.touches[0].clientY, el);
    }
  }

  onTouchMove(ev: TouchEvent): void {
    const el = this.view.element();
    if (!el) return;

    if (ev.touches.length === 2 && this.pinchStartDist > 0) {
      ev.preventDefault();
      const ratio = pinchDistance(ev.touches) / this.pinchStartDist;
      const target = clamp(
        +(this.pinchStartZoom * ratio).toFixed(3),
        this.view.minZoom,
        this.view.maxZoom,
      );
      const before = this.view.zoom();
      if (target !== before) this.applyZoomAboutCentre(el, before, target);
      this.moved = true;
      return;
    }

    if (this.panning && ev.touches.length === 1) {
      this.dragTo(ev.touches[0].clientX, ev.touches[0].clientY, el);
      ev.preventDefault(); // we own the scroll, so the page never rubber-bands
    }
  }

  onTouchEnd(ev: TouchEvent): void {
    if (ev.touches.length > 0) return;
    this.panning = false;
    this.pinchStartDist = 0;
    this.clearGestureFlagSoon();
  }

  // -------------------------------------------------------------- mouse ----

  onMouseDown(ev: MouseEvent): void {
    const el = this.view.element();
    if (el) this.beginPan(ev.clientX, ev.clientY, el);
  }

  onMouseMove(ev: MouseEvent): void {
    const el = this.view.element();
    if (el && this.panning) this.dragTo(ev.clientX, ev.clientY, el);
  }

  onMouseUp(): void {
    this.panning = false;
    this.clearGestureFlagSoon();
  }

  /** Ctrl/⌘ + wheel zooms; a plain wheel scrolls the map normally. */
  onWheel(ev: WheelEvent): void {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    this.zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  // ------------------------------------------------------------ internals --

  private beginPan(x: number, y: number, el: HTMLDivElement): void {
    this.panning = true;
    this.startX = x;
    this.startY = y;
    this.startScrollX = el.scrollLeft;
    this.startScrollY = el.scrollTop;
  }

  private dragTo(x: number, y: number, el: HTMLDivElement): void {
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.moved = true;
    el.scrollLeft = this.startScrollX - dx;
    el.scrollTop = this.startScrollY - dy;
  }

  private applyZoomAboutCentre(el: HTMLDivElement, before: number, after: number): void {
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    const k = after / before;
    this.view.setZoom(after);
    requestAnimationFrame(() => {
      el.scrollLeft = cx * k - el.clientWidth / 2;
      el.scrollTop = cy * k - el.clientHeight / 2;
    });
  }

  /** Let the click handler observe the flag, then reset it. */
  private clearGestureFlagSoon(): void {
    setTimeout(() => (this.moved = false), 0);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pinchDistance(t: TouchList): number {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}
