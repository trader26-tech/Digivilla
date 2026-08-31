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
import { BASE_GRID } from './estate/iso.model';
import {
  Cell,
  boardOrigin,
  boardSize,
  buildCells,
  gridSize,
} from './estate/board-layout';
import { MapGestures, MapViewport } from './estate/map-gestures';
import { compact } from './shared/format.util';

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
 * The board is the "estate board" reference: one 2:1 isometric diamond grid
 * whose parcels are painted with three interchangeable SVG symbols —
 * #tLocked (open tile), #tLand (bare land / building base) and #tVilla
 * (finished villa). The heavy hand-drawn hall/villa geometry is gone; each
 * cell is now a single <use> plus, for a build in progress, one construction
 * group. Layout, zoom and pointer handling are unchanged.
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
  /** Hidden file picker behind the corner avatar. */
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;

  /** Tapping a built tile asks the shell to open its detail page. */
  @Output() openTile = new EventEmitter<Tile>();
  @Output() explore = new EventEmitter<void>();
  @Output() progress = new EventEmitter<void>();

  readonly est = inject(EstateService);

  /** Buy sheet state: the open plot being filled, or null. */
  buying = signal<Cell | null>(null);
  /** Detail popup state: the tapped cell (owned tile or open plot), or null. */
  selected = signal<Cell | null>(null);
  /** Just-collected toast amount, or 0. */
  collected = signal(0);
  /** The right-hand figure has two faces: monthly rent (default) and build
   *  cost. Tapping morphs between them in place. */
  showBuildCost = signal(false);
  toggleRentFace(): void { this.showBuildCost.update((v) => !v); }

  // -------------------------------------------------------- owner photo ----

  /** Open the OS photo picker (fired from the corner avatar). */
  pickPhoto(): void {
    this.photoInput?.nativeElement.click();
  }

  /** Read the chosen image as a data URL and store it on the profile so it
   *  persists and shows in the corner avatar. */
  onPhotoChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const photo = typeof reader.result === 'string' ? reader.result : undefined;
      if (photo) this.est.setProfile({ photo });
    };
    reader.readAsDataURL(file);
    input.value = ''; // allow re-picking the same file later
  }

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

  // ---------------------------------------------------------- board glue ---
  // The reference symbols are authored around their own local origin: #tLand /
  // #tVilla / #tLocked centre on (120, 80). Our cell centres are (c.x, c.y).
  // A <use> is placed at (c.x - 120, c.y - 80) so the symbol lands on the cell.
  private readonly SYM_CX = 120;
  private readonly SYM_CY = 80;
  useX(c: Cell): number { return c.x - this.SYM_CX; }
  useY(c: Cell): number { return c.y - this.SYM_CY; }

  /** Which reference symbol paints this cell's ground. */
  symbolFor(c: Cell): string {
    if (c.hall) return '#tVilla';                 // the hall reads as the grandest villa
    const t = c.tile;
    if (!t) return '#tLocked';                    // open plot
    if (t.type === 'villa') return '#tVilla';
    return '#tLand';                              // land + building both stand on bare land
  }

  /** The construction group is drawn on top of #tLand while a villa builds. */
  isBuilding(c: Cell): boolean { return c.tile?.type === 'building'; }

  /** Transform placing the reference construction group on this cell. It is
   *  authored in the reference at translate(x,y) scale(0.385) translate(-640,-430);
   *  we re-anchor it to the cell centre and drop it slightly onto the land. */
  buildTransform(c: Cell): string {
    return `translate(${c.x},${c.y + 20}) scale(0.32) translate(-640,-430)`;
  }

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
    // Bias the framing downward so the hero greeting (which floats over the
    // top of the map) never sits on top of the town.
    const HERO_INSET = 40;
    el.scrollLeft = Math.round(cx - el.clientWidth / 2);
    el.scrollTop = Math.round(cy - (el.clientHeight + HERO_INSET) / 2);
  }

  // ---------------------------------------------------------- interaction --

  tapCell(c: Cell): void {
    if (this.gestures.wasGesture) return; // a pan or pinch, not a tap
    if (c.hall) return;                   // the hall is a landmark, not a plot
    if (navigator.vibrate) navigator.vibrate(4);
    // Every tap opens the detail popup — for a built tile OR an open plot.
    this.selected.set(c);
  }

  /** Close the detail popup. */
  closeDetail(): void {
    this.selected.set(null);
  }

  /** From the detail popup: open the full detail page for this tile. */
  openFull(t: Tile): void {
    this.selected.set(null);
    this.openTile.emit(t);
  }

  /** From an open-plot popup: switch to the build chooser. */
  startBuild(c: Cell): void {
    this.selected.set(null);
    this.buying.set(c);
  }

  // -------- detail popup: the numbers the card shows --------

  /** 1-based plot number, matching the fill order. */
  plotNo(c: Cell): number { return c.index + 1; }

  /** Which estate-board symbol the popup preview should <use> — the SAME
   *  symbols the map paints with, so the preview matches the tile exactly.
   *  A building stands on bare land (with #tBuild layered on top). */
  popSymbol(c: Cell): string {
    const t = c.tile;
    if (!t) return '#tLocked';
    if (t.type === 'villa') return '#tVilla';
    return '#tLand';
  }

  /** Which estate-board symbol a given owned tile shows in the asset log. */
  tileSymbol(t: Tile): string {
    return t.type === 'villa' ? '#tVilla' : '#tLand';
  }

  /** Human label for an owned tile's kind. */
  tileKind(t: Tile): string {
    return t.type === 'villa' ? 'Villa' : t.type === 'building' ? 'Building' : 'Land';
  }

  /** Every asset the user has bought, newest purchase first — the log rows. */
  get ownedLog(): Tile[] {
    return [...this.est.tiles()].sort((a, b) => b.boughtAt - a.boughtAt);
  }

  /** Build progress as "<accrued-months> of <target-months>", reference-style. */
  buildStep(t: Tile): { done: number; total: number } {
    const total = t.sipMonthly > 0 ? Math.round(t.cost / t.sipMonthly) : 60;
    const done = t.sipMonthly > 0 ? Math.round(t.sipAccrued / t.sipMonthly) : 0;
    return { done: Math.min(done, total), total };
  }

  buildPct(t: Tile): number {
    const { done, total } = this.buildStep(t);
    return total > 0 ? Math.round((done / total) * 100) : 0;
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

  compact = compact;

  get villas(): number { return this.est.countOf('villa'); }
  get buildings(): number { return this.est.countOf('building'); }
  get lands(): number { return this.est.countOf('land'); }
  get open(): number { return this.est.openPlots; }
  get hasAny(): boolean { return this.est.tiles().length > 0; }
}
