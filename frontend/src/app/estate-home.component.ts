import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';

import { EstateService, Tile, TileType, Variant } from './estate.service';
import { BASE_GRID, TILE_W, TILE_H } from './estate/iso.model';
import {
  Cell,
  boardOrigin,
  boardSize,
  buildCells,
  gridSize,
} from './estate/board-layout';
import { MapGestures, MapViewport } from './estate/map-gestures';
import * as iso from './estate/iso-draw';

/** Ticket price for one parcel; villas and builds are multiples of it. */
const PLOT_TICKET = 10_00_000;

/** Locality names cycled through as the town grows. */
const LOCALITIES = [
  'Kelambakkam Grove', 'Siruseri Rise', 'Navalur Court', 'OMR Meadows',
  'Thaiyur Green', 'Padur Vista', 'Mahindra City Edge', 'Guduvancheri Park',
];

/**
 * The estate home screen.
 *
 * This component is deliberately thin: geometry lives in estate/iso-draw,
 * board layout in estate/board-layout, and pointer handling in
 * estate/map-gestures. What remains here is view state and user intent.
 */
@Component({
  selector: 'app-estate-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './estate-home.component.html',
  styleUrl: './estate-home.component.scss',
})
export class EstateHomeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('scroller') scroller?: ElementRef<HTMLDivElement>;

  /** Tapping a built tile asks the shell to open its detail page. */
  @Output() openTile = new EventEmitter<Tile>();
  @Output() explore = new EventEmitter<void>();
  @Output() progress = new EventEmitter<void>();

  readonly est = inject(EstateService);

  // geometry the template needs
  readonly TILE_W = TILE_W;
  readonly TILE_H = TILE_H;
  readonly paneSpots = iso.PANE_SPOTS;
  readonly hallWinSpots = iso.HALL_WIN_SPOTS;

  /** Buy sheet state: the open plot being filled, or null. */
  buying = signal<Cell | null>(null);
  /** Just-collected toast amount, or 0. */
  collected = signal(0);

  // ------------------------------------------------------------- zooming ---

  /** The default framing is the closest one; the user may step out once, and
   *  only after the town has outgrown the base board. */
  readonly MIN_ZOOM = 1;
  readonly MAX_ZOOM = 1.5;
  zoom = signal(1.5);

  private readonly viewport: MapViewport = {
    element: () => this.scroller?.nativeElement,
    zoom: () => this.zoom(),
    setZoom: (z) => this.zoom.set(z),
    minZoom: this.MIN_ZOOM,
    maxZoom: this.MAX_ZOOM,
    enabled: () => this.canZoom,
  };
  private readonly gestures = new MapGestures(this.viewport);

  zoomIn(): void { this.gestures.zoomBy(1.5); }
  zoomOut(): void { this.gestures.zoomBy(1 / 1.5); }

  /** Zoom only means anything once the board has grown past the base 3x3. */
  get canZoom(): boolean { return this.grid > BASE_GRID; }
  get canZoomIn(): boolean { return this.canZoom && this.zoom() < this.MAX_ZOOM - 0.001; }
  get canZoomOut(): boolean { return this.canZoom && this.zoom() > this.MIN_ZOOM + 0.001; }

  // gesture events, forwarded to the controller
  onTouchStart(e: TouchEvent): void { this.gestures.onTouchStart(e); }
  onTouchMove(e: TouchEvent): void { this.gestures.onTouchMove(e); }
  onTouchEnd(e: TouchEvent): void { this.gestures.onTouchEnd(e); }
  onMouseDown(e: MouseEvent): void { this.gestures.onMouseDown(e); }
  onMouseMove(e: MouseEvent): void { this.gestures.onMouseMove(e); }
  onMouseUp(): void { this.gestures.onMouseUp(); }
  onWheel(e: WheelEvent): void { this.gestures.onWheel(e); }

  // -------------------------------------------------------------- board ----

  get grid(): number { return gridSize(this.est.tiles().length); }

  /** Every cell, owned tiles assigned and sorted back-to-front for painting. */
  cells = computed<Cell[]>(() => buildCells(this.est.tiles()));

  get boardW(): number { return boardSize(this.grid).w; }
  get boardH(): number { return boardSize(this.grid).h; }
  get offX(): number { return boardOrigin(this.grid).x; }
  get offY(): number { return boardOrigin(this.grid).y; }

  /** Rendered size = intrinsic x zoom, used only once the board can scroll. */
  private readonly ZOOM_BASE = 0.62;
  private get scale(): number { return this.ZOOM_BASE * this.zoom(); }
  get renderW(): number { return this.boardW * this.scale; }
  get renderH(): number { return this.boardH * this.scale; }

  // ---------------------------------------------------------- iso-draw -----
  // Thin pass-throughs so the template can call the pure helpers directly.

  diamond = iso.diamond;
  diamondAt = iso.diamondAt;
  boxTop = iso.boxTop;
  boxLeft = iso.boxLeft;
  boxRight = iso.boxRight;
  windowLeft = iso.windowLeft;
  windowRight = iso.windowRight;
  paneLeft = iso.paneLeft;
  paneRight = iso.paneRight;
  fenceRailPath = iso.fenceRailPath;
  fencePostBoxes = iso.fencePostBoxes;
  frameColumns = iso.frameColumns;
  frameRing = iso.frameRing;
  villaBushes = iso.villaBushes;

  /** Rails/posts for one side of a plot, named the way the template reads. */
  backRails = (x: number, y: number, inset?: number, t?: number) =>
    iso.sideRails(x, y, 'back', inset, t);
  perimeterRails = (x: number, y: number, inset?: number, t?: number) =>
    iso.sideRails(x, y, 'front', inset, t);
  backPosts = (x: number, y: number, inset?: number, t?: number) =>
    iso.sidePosts(x, y, 'back', inset, t);
  perimeterPosts = (x: number, y: number, inset?: number, t?: number) =>
    iso.sidePosts(x, y, 'front', inset, t);

  // ------------------------------------------------------------ lifecycle --

  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    this.centreOnTown();
    requestAnimationFrame(() => this.centreOnTown());

    // Re-centre the first time the container reports a real size — more
    // reliable than guessing at timings.
    const el = this.scroller?.nativeElement;
    if (el && typeof ResizeObserver !== 'undefined') {
      let settled = false;
      this.ro = new ResizeObserver(() => {
        if (!settled && el.clientWidth > 0) {
          settled = true;
          this.centreOnTown();
        }
      });
      this.ro.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  /** Centre the view on the hall plus everything built, so the interesting
   *  part is always in frame rather than a corner of empty grid. */
  private centreOnTown(): void {
    const el = this.scroller?.nativeElement;
    if (!el || !el.clientWidth) return;

    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const c of this.cells()) {
      if (!c.tile && !c.hall) continue;
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    const cx = (this.offX + (minX + maxX) / 2) * this.scale;
    const cy = (this.offY + (minY + maxY) / 2) * this.scale;
    el.scrollLeft = Math.round(cx - el.clientWidth / 2);
    el.scrollTop = Math.round(cy - el.clientHeight / 2);
  }

  // ---------------------------------------------------------- interaction --

  tapCell(c: Cell): void {
    if (this.gestures.wasGesture) return; // a pan or pinch, not a tap
    if (navigator.vibrate) navigator.vibrate(4);
    if (c.tile) this.openTile.emit(c.tile);
    else this.buying.set(c);
  }

  /** Build the chosen asset on the pending plot. */
  buy(type: TileType, variant: Variant): void {
    const cost = this.costFor(type);
    this.est.addTile({
      type,
      variant,
      cost,
      sipMonthly: type === 'building' ? Math.round(cost / 60) : 0,        // ~5yr build
      sipAccrued: type === 'building' ? Math.round(cost * 0.12) : 0,      // a little in
      rentMonthly: type === 'villa' ? Math.round((cost * 0.06) / 12) : 0, // ~6%/yr
      label: this.nextLocality(),
    });
    this.buying.set(null);
    if (navigator.vibrate) navigator.vibrate([5, 30, 8]);
  }

  cancelBuy(): void {
    this.buying.set(null);
  }

  collect(): void {
    const amt = this.est.collectRent();
    if (amt <= 0) return;
    this.collected.set(amt);
    if (navigator.vibrate) navigator.vibrate([6, 40, 10]);
    setTimeout(() => this.collected.set(0), 2600);
  }

  // ------------------------------------------------------------- helpers ---

  private costFor(type: TileType): number {
    if (type === 'villa') return PLOT_TICKET * 3;
    if (type === 'building') return PLOT_TICKET * 2;
    return PLOT_TICKET;
  }

  private nextLocality(): string {
    return LOCALITIES[this.est.tiles().length % LOCALITIES.length];
  }

  compact(v: number): string {
    if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1).replace(/\.0$/, '')} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  get villas(): number { return this.est.countOf('villa'); }
  get buildings(): number { return this.est.countOf('building'); }
  get lands(): number { return this.est.countOf('land'); }
  get open(): number { return this.est.openPlots; }
  get hasAny(): boolean { return this.est.tiles().length > 0; }
}
