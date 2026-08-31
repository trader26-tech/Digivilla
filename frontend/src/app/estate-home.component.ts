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

import { CallScheduleComponent } from './shared/call-schedule.component';
import { CallsService } from './shared/calls.service';
import { EstateService, Tile, TileType, Variant } from './estate.service';
import { BASE_GRID } from './estate/iso.model';
import {
  Cell,
  boardOrigin,
  boardSize,
  buildCells,
  centreTile,
  gridSize,
} from './estate/board-layout';
import { MapGestures, MapViewport } from './estate/map-gestures';
import { compact } from './shared/format.util';

/** Ticket price for one parcel; villas and builds are multiples of it. */
const PLOT_TICKET = 10_00_000;

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
  imports: [CommonModule, FormsModule, CallScheduleComponent],
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
  /** "Build a new asset" -> open the villa/land pick screen. */
  @Output() build = new EventEmitter<void>();
  /** The corner avatar -> open the account page. */
  @Output() account = new EventEmitter<void>();

  readonly est = inject(EstateService);
  private readonly callsSvc = inject(CallsService);

  /** Buy sheet state: the open plot being filled, or null. */
  buying = signal<Cell | null>(null);

  // -- buying requires booking a fund-manager call; the user cannot create a
  //    plot themselves. The chosen type + a small calendar flow live here. --
  /** The asset type the user has asked to build (drives the call topic). */
  requestType = signal<TileType | null>(null);
  /** Book-a-call step: 1 pick date · 2 pick time · 3 request sent. */
  bkStep = signal(1);
  bkMonth = signal(this.firstOfMonth());
  bkDay = signal<Date | null>(null);
  bkSlot = signal<string | null>(null);
  bkSent = signal(false);
  readonly BK_SLOTS = ['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '5:00 PM'];

  private firstOfMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  private typeWord(t: TileType): string {
    return t === 'villa' ? 'Villa' : t === 'building' ? 'Villa (SIP build)' : 'Land';
  }
  /** The chosen type as a word, for the template. */
  typeWordFor(): string {
    const t = this.requestType();
    return t ? this.typeWord(t) : 'asset';
  }
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

  /** First-time empty state: open the buy sheet on the first open plot (the
   *  one nearest the hall), so a new user goes straight into buying. */
  buildFirst(): void {
    const first = this.cells().find((c) => !c.hall && !c.tile);
    if (first) this.buying.set(first);
    if (navigator.vibrate) navigator.vibrate(6);
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

  /** Every asset the user owns, newest purchase first — the log rows. Includes
   *  the founding centre villa, which is a real asset even though it lives in
   *  the board layout rather than the tiles list. It sorts last (boughtAt 0). */
  get ownedLog(): Tile[] {
    return [centreTile(), ...this.est.tiles()].sort((a, b) => b.boughtAt - a.boughtAt);
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

  /** Whole months left until a building finishes and becomes a villa. */
  monthsLeft(t: Tile): number {
    const { done, total } = this.buildStep(t);
    return Math.max(0, total - done);
  }

  /** Days left until a building completes (~30 days per remaining month). */
  daysLeft(t: Tile): number {
    return this.monthsLeft(t) * 30;
  }

  /** The date the building is expected to finish. */
  completesOn(t: Tile): Date {
    return new Date(Date.now() + this.daysLeft(t) * 86_400_000);
  }

  /** The monthly rent a building will pay once it's finished (~6%/yr of cost),
   *  matching how a villa's rent is set when it's created. */
  futureRent(t: Tile): number {
    return Math.round((t.cost * 0.06) / 12);
  }

  /** Representative annual growth (CAGR) for a land plot — a pure equity
   *  basket. Fixed rate so the number is stable per session. */
  private readonly LAND_CAGR = 0.12;
  landCagrPct(): number {
    return Math.round(this.LAND_CAGR * 100);
  }
  /** A land plot's value today, its cost grown at the CAGR since purchase. */
  landValue(t: Tile): number {
    const years = Math.max(0, (Date.now() - t.boughtAt) / (365.25 * 86_400_000));
    return Math.round(t.cost * Math.pow(1 + this.LAND_CAGR, years));
  }

  /** The user picked what to build. They cannot create it themselves — this
   *  opens the fund-manager call booking. The plot appears only after the
   *  manager approves the request; booking the call sends the request. */
  buy(type: TileType, _variant: Variant): void {
    this.requestType.set(type);
    this.bkStep.set(1);
    this.bkMonth.set(this.firstOfMonth());
    this.bkDay.set(null);
    this.bkSlot.set(null);
    this.bkSent.set(false);
    if (navigator.vibrate) navigator.vibrate(4);
  }

  cancelBuy(): void {
    this.buying.set(null);
    this.requestType.set(null);
  }

  // ---- book-a-call calendar (buying) ----
  get bkMonthLabel(): string {
    return this.bkMonth().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  get bkCells(): (Date | null)[] {
    const m = this.bkMonth();
    const y = m.getFullYear(), mon = m.getMonth();
    const lead = new Date(y, mon, 1).getDay();
    const days = new Date(y, mon + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(y, mon, d));
    return cells;
  }
  get bkCanPrev(): boolean { return this.bkMonth() > this.firstOfMonth(); }
  bkPrevMonth(): void {
    if (!this.bkCanPrev) return;
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  bkNextMonth(): void {
    const m = this.bkMonth();
    this.bkMonth.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }
  bkSelectable(dt: Date): boolean {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) return false;
    const min = new Date(); min.setHours(0, 0, 0, 0); min.setDate(min.getDate() + 2);
    return dt.getTime() >= min.getTime();
  }
  bkIsDay(dt: Date): boolean {
    const d = this.bkDay();
    return !!d && d.getTime() === dt.getTime();
  }
  bkPickDay(dt: Date): void {
    if (!this.bkSelectable(dt)) return;
    this.bkDay.set(dt);
    this.bkSlot.set(null);
    this.bkStep.set(2);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  /** Book the call with the fund manager — this SENDS the request. The plot is
   *  not created; it stays pending until the manager approves. */
  bkPickSlot(slot: string): void {
    const type = this.requestType();
    const day = this.bkDay();
    if (!type || !day) return;
    this.bkSlot.set(slot);
    // combine day + slot into a real datetime and book via the shared service
    const [hm, ap] = slot.split(' ');
    let [h, m] = hm.split(':').map(Number);
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const at = new Date(day);
    at.setHours(h, m, 0, 0);
    this.callsSvc.book(at, `Approve & build a ${this.typeWord(type)}`);
    this.bkSent.set(true);
    this.bkStep.set(3);
    if (navigator.vibrate) navigator.vibrate([6, 40, 12]);
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

  /** A consistent, numbered name per type: "Villa 1", "Land 1",
   *  "Under Construction 1" — the next number for that type. */
  private nextName(type: TileType): string {
    const n = this.est.countOf(type) + 1;
    const word = type === 'villa' ? 'Villa' : type === 'building' ? 'Under Construction' : 'Land';
    return `${word} ${n}`;
  }

  compact = compact;

  get villas(): number { return this.est.countOf('villa'); }
  get buildings(): number { return this.est.countOf('building'); }
  get lands(): number { return this.est.countOf('land'); }
  get open(): number { return this.est.openPlots; }
  get hasAny(): boolean { return this.est.tiles().length > 0; }
}
