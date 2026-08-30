import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit,
  OnDestroy,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';

import { EstateService, Tile, TileType, Variant, TOTAL_PLOTS } from './estate.service';

/** A cell on the isometric board: grid col/row + screen x/y + optional tile. */
interface Cell {
  col: number;
  row: number;
  x: number;   // screen centre
  y: number;
  tile: Tile | null;
  index: number;   // ring order — which plot slot this is
  hall: boolean;   // the central town hall occupies one cell
}

/** Isometric tile footprint. The board is large and scrollable in both
 *  directions, so the town can keep growing outward from the hall. */
const TILE_W = 128;   // full diamond width
const TILE_H = 64;    // full diamond height
const GRID = 11;      // a wide board — feels boundless; the viewport scrolls freely

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
  /** Explore / Progress tab taps bubble up (shell owns navigation). */
  @Output() explore = new EventEmitter<void>();
  @Output() progress = new EventEmitter<void>();

  readonly est = inject(EstateService);
  readonly TILE_W = TILE_W;
  readonly TILE_H = TILE_H;

  /** Estate name — editable later; a friendly default for now. */
  estateName = signal(localStorage.getItem('estate_name') || "Your City");

  /** Buy sheet state: the open plot being filled, or null. */
  buying = signal<Cell | null>(null);
  /** Just-collected toast amount, or 0. */
  collected = signal(0);

  /** Zoom. The DEFAULT is the closest framing — a comprehensive view of the
   *  town where everything you own reads clearly. That is also the maximum;
   *  the user may step out exactly once to see more of the surrounding plots.
   *  Deliberately tight so the map never becomes a sea of empty grid. */
  readonly MIN_ZOOM = 1;
  readonly MAX_ZOOM = 1.5;
  zoom = signal(1.5);

  /** Zoom about the centre of the viewport, keeping that point steady. */
  private zoomBy(factor: number): void {
    const el = this.scroller?.nativeElement;
    const before = this.zoom();
    const after = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, +(before * factor).toFixed(3)));
    if (after === before) return;
    if (!el) { this.zoom.set(after); return; }
    // keep the viewport centre anchored across the zoom
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    const k = after / before;
    this.zoom.set(after);
    requestAnimationFrame(() => {
      el.scrollLeft = cx * k - el.clientWidth / 2;
      el.scrollTop = cy * k - el.clientHeight / 2;
    });
  }
  zoomIn(): void { this.zoomBy(1.5); }
  zoomOut(): void { this.zoomBy(1 / 1.5); }
  get canZoomIn(): boolean { return this.zoom() < this.MAX_ZOOM - 0.001; }
  get canZoomOut(): boolean { return this.zoom() > this.MIN_ZOOM + 0.001; }

  // ================= touch gestures (mobile-first PWA) =================
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private panStartX = 0;
  private panStartY = 0;
  private panScrollX = 0;
  private panScrollY = 0;
  private panning = false;
  /** True while a pinch/pan is in flight, so a tap doesn't fire a buy sheet. */
  private gestured = false;

  private dist(t: TouchList): number {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }

  onTouchStart(ev: TouchEvent): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    if (ev.touches.length === 2) {
      this.pinchStartDist = this.dist(ev.touches);
      this.pinchStartZoom = this.zoom();
      this.panning = false;
      this.gestured = true;
    } else if (ev.touches.length === 1) {
      this.panning = true;
      this.panStartX = ev.touches[0].clientX;
      this.panStartY = ev.touches[0].clientY;
      this.panScrollX = el.scrollLeft;
      this.panScrollY = el.scrollTop;
    }
  }

  onTouchMove(ev: TouchEvent): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;

    if (ev.touches.length === 2 && this.pinchStartDist > 0) {
      ev.preventDefault();
      const ratio = this.dist(ev.touches) / this.pinchStartDist;
      const target = Math.max(
        this.MIN_ZOOM,
        Math.min(this.MAX_ZOOM, +(this.pinchStartZoom * ratio).toFixed(3)),
      );
      const before = this.zoom();
      if (target !== before) {
        const cx = el.scrollLeft + el.clientWidth / 2;
        const cy = el.scrollTop + el.clientHeight / 2;
        const k = target / before;
        this.zoom.set(target);
        requestAnimationFrame(() => {
          el.scrollLeft = cx * k - el.clientWidth / 2;
          el.scrollTop = cy * k - el.clientHeight / 2;
        });
      }
      this.gestured = true;
      return;
    }

    if (this.panning && ev.touches.length === 1) {
      const dx = ev.touches[0].clientX - this.panStartX;
      const dy = ev.touches[0].clientY - this.panStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.gestured = true;
      el.scrollLeft = this.panScrollX - dx;
      el.scrollTop = this.panScrollY - dy;
      ev.preventDefault(); // we own the scroll, so the page never rubber-bands
    }
  }

  onTouchEnd(ev: TouchEvent): void {
    if (ev.touches.length === 0) {
      this.panning = false;
      this.pinchStartDist = 0;
      // let the tap handler see the flag, then clear it
      setTimeout(() => (this.gestured = false), 0);
    }
  }

  /** Mouse drag-to-pan on desktop. */
  onMouseDown(ev: MouseEvent): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    this.panning = true;
    this.panStartX = ev.clientX;
    this.panStartY = ev.clientY;
    this.panScrollX = el.scrollLeft;
    this.panScrollY = el.scrollTop;
  }
  onMouseMove(ev: MouseEvent): void {
    const el = this.scroller?.nativeElement;
    if (!el || !this.panning) return;
    const dx = ev.clientX - this.panStartX;
    const dy = ev.clientY - this.panStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.gestured = true;
    el.scrollLeft = this.panScrollX - dx;
    el.scrollTop = this.panScrollY - dy;
  }
  onMouseUp(): void {
    this.panning = false;
    setTimeout(() => (this.gestured = false), 0);
  }

  /** Ctrl/⌘ + wheel zooms; plain wheel scrolls the map. */
  onWheel(ev: WheelEvent): void {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    this.zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  /** The board: a town hall dead centre, with plots filling outward from it
   *  ring by ring, so the town always grows around the landmark. */
  cells = computed<Cell[]>(() => {
    const tiles = this.est.tiles();
    const mid = Math.floor(GRID / 2);

    // Every cell, sorted by distance from the hall (then clockwise-ish) so
    // owned tiles cluster tightly around the centre instead of scattering.
    const all: { col: number; row: number; d: number; a: number }[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        if (col === mid && row === mid) continue; // reserved for the hall
        const dc = col - mid;
        const dr = row - mid;
        all.push({
          col,
          row,
          d: Math.max(Math.abs(dc), Math.abs(dr)), // ring number
          a: Math.atan2(dr, dc),
        });
      }
    }
    // Fill order: nearest ring first, and WITHIN a ring prefer plots that sit
    // in FRONT of the hall (higher col+row draws later / nearer the viewer).
    // The hall is tall, so anything placed behind it would be hidden — this
    // keeps new builds in clear view.
    all.sort((p, q) => {
      if (p.d !== q.d) return p.d - q.d;
      const pf = p.col + p.row;
      const qf = q.col + q.row;
      if (pf !== qf) return qf - pf;   // front-most first
      return p.a - q.a;
    });

    const out: Cell[] = [];
    // the hall itself
    out.push({
      col: mid,
      row: mid,
      x: (mid - mid) * (TILE_W / 2),
      y: (mid + mid) * (TILE_H / 2),
      tile: null,
      index: -1,
      hall: true,
    });
    all.forEach((c, i) => {
      out.push({
        col: c.col,
        row: c.row,
        x: (c.col - c.row) * (TILE_W / 2),
        y: (c.col + c.row) * (TILE_H / 2),
        tile: tiles[i] ?? null,
        index: i,
        hall: false,
      });
    });
    // paint back-to-front so nearer tiles overlap farther ones correctly
    out.sort((p, q) => (p.col + p.row) - (q.col + q.row));
    return out;
  });

  /** Intrinsic board size (viewBox units) — the full board, unscaled. */
  get boardW(): number {
    return GRID * TILE_W + 80;
  }
  get boardH(): number {
    return GRID * TILE_H + 200; // headroom for roofs, cranes and coins
  }

  /** Rendered size = intrinsic × zoom. The SVG is drawn bigger/smaller than its
   *  viewBox, so the scroll container shows a zoomed slice of the town.
   *  ZOOM_BASE is tuned so that at zoom 1 roughly a 3×3 patch fills the view. */
  private readonly ZOOM_BASE = 0.92;
  get renderW(): number {
    return this.boardW * this.ZOOM_BASE * this.zoom();
  }
  get renderH(): number {
    return this.boardH * this.ZOOM_BASE * this.zoom();
  }
  /** Scale factor from viewBox units to rendered pixels. */
  private get scale(): number {
    return this.ZOOM_BASE * this.zoom();
  }
  /** Shift so the leftmost diamond isn't clipped. */
  get offX(): number {
    return (GRID - 1) * (TILE_W / 2) + 40;
  }
  get offY(): number {
    return 110; // room above for coins / villa roofs
  }

  /** Diamond path for a cell centre (x,y). */
  diamond(x: number, y: number): string {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    return `M${x},${y - hh} L${x + hw},${y} L${x},${y + hh} L${x - hw},${y} Z`;
  }

  /** A smaller diamond, inset by `k` (0..1) — for pools, patios, driveways. */
  diamondAt(x: number, y: number, k: number): string {
    const hw = (TILE_W / 2) * k;
    const hh = (TILE_H / 2) * k;
    return `M${x},${y - hh} L${x + hw},${y} L${x},${y + hh} L${x - hw},${y} Z`;
  }

  // ============ isometric box primitives ============
  // An iso box is drawn as three faces from a base centre (bx,by):
  //   top    — a diamond raised by `h`
  //   left   — the -x face
  //   right  — the +x face
  // `w` is the half-width in iso units (1 = a full tile).

  /** Top face of an iso box of half-width w, raised h above the base point. */
  boxTop(bx: number, by: number, w: number, h: number): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    const y = by - h;
    return `M${bx},${y - hh} L${bx + hw},${y} L${bx},${y + hh} L${bx - hw},${y} Z`;
  }
  /** Left (-x) vertical face. */
  boxLeft(bx: number, by: number, w: number, h: number): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    return `M${bx - hw},${by - h} L${bx},${by - h + hh} L${bx},${by + hh} L${bx - hw},${by} Z`;
  }
  /** Right (+x) vertical face. */
  boxRight(bx: number, by: number, w: number, h: number): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    return `M${bx},${by - h + hh} L${bx + hw},${by - h} L${bx + hw},${by} L${bx},${by + hh} Z`;
  }

  /** Window band on the left face (a thin horizontal strip). */
  windowLeft(bx: number, by: number, w: number, h: number, t: number): string {
    const hw = (TILE_W / 2) * w * 0.72;
    const hh = (TILE_H / 2) * w * 0.72;
    const yTop = by - h + t;
    const band = 7;
    return `M${bx - hw},${yTop} L${bx},${yTop + hh} L${bx},${yTop + hh + band} L${bx - hw},${yTop + band} Z`;
  }
  /** Window band on the right face. */
  windowRight(bx: number, by: number, w: number, h: number, t: number): string {
    const hw = (TILE_W / 2) * w * 0.72;
    const hh = (TILE_H / 2) * w * 0.72;
    const yTop = by - h + t;
    const band = 7;
    return `M${bx},${yTop + hh} L${bx + hw},${yTop} L${bx + hw},${yTop + band} L${bx},${yTop + hh + band} Z`;
  }

  // ---- DISCRETE window panes (not one long strip) --------------------------
  // Each pane is a small parallelogram sitting on a face, placed at a fraction
  // `f` (0..1) along that face — so windows read as separate openings toward
  // the ends of the wall, the way the reference art does.

  /** One pane on the left (-x) face at position f along it. */
  paneLeft(bx: number, by: number, w: number, h: number, t: number, f: number, pw = 0.2): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    // walk from the left corner (-hw, 0) toward the centre (0, +hh)
    const x0 = bx - hw + hw * f;
    const y0 = by - h + t + hh * f;
    const x1 = bx - hw + hw * (f + pw);
    const y1 = by - h + t + hh * (f + pw);
    const band = 8;
    return `M${x0},${y0} L${x1},${y1} L${x1},${y1 + band} L${x0},${y0 + band} Z`;
  }
  /** One pane on the right (+x) face at position f along it. */
  paneRight(bx: number, by: number, w: number, h: number, t: number, f: number, pw = 0.2): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    // walk from the centre (0, +hh) toward the right corner (+hw, 0)
    const x0 = bx + hw * f;
    const y0 = by - h + t + hh * (1 - f);
    const x1 = bx + hw * (f + pw);
    const y1 = by - h + t + hh * (1 - f - pw);
    const band = 8;
    return `M${x0},${y0} L${x1},${y1} L${x1},${y1 + band} L${x0},${y0 + band} Z`;
  }
  /** Pane positions for a wall: two openings set toward the ends. */
  readonly paneSpots = [0.14, 0.62];
  /** Evenly spaced window positions across a town-hall wall. */
  readonly hallWinSpots = [0.10, 0.34, 0.58, 0.80];

  /** Fence posts + rail along the two far edges of a tile (back-left, back-right). */
  fencePath(x: number, y: number): string {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const inset = 0.9;
    const t = 9; // rail height
    // back-left edge: from left corner to top corner; back-right: top to right
    return (
      `M${x - hw * inset},${y - 2} L${x},${y - hh * inset - 2} ` +
      `M${x},${y - hh * inset - 2} L${x + hw * inset},${y - 2} ` +
      `M${x - hw * inset},${y - 2 - t} L${x},${y - hh * inset - 2 - t} ` +
      `M${x},${y - hh * inset - 2 - t} L${x + hw * inset},${y - 2 - t}`
    );
  }
  /** Vertical fence posts along the same two edges. */
  fencePosts(x: number, y: number): { x1: number; y1: number; x2: number; y2: number }[] {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const inset = 0.9;
    const t = 11;
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const f of [0, 0.5, 1]) {
      // back-left edge
      const lx = -hw * inset + (hw * inset) * f;
      const ly = -2 - (hh * inset) * f;
      out.push({ x1: x + lx, y1: y + ly, x2: x + lx, y2: y + ly - t });
      // back-right edge
      const rx = (hw * inset) * f;
      const ry = -hh * inset - 2 + (hh * inset) * f;
      out.push({ x1: x + rx, y1: y + ry, x2: x + rx, y2: y + ry - t });
    }
    return out;
  }

  /** Hedge cube positions around a villa. */
  hedges(x: number, y: number): { x: number; y: number }[] {
    return [
      { x: x + 34, y: y - 2 },
      { x: x + 22, y: y + 8 },
      { x: x - 34, y: y + 2 },
    ];
  }

  // ==========================================================================
  //  RICH ASSET LIBRARY — deterministic, seeded per tile so the estate looks
  //  hand-placed but never re-shuffles between renders.
  // ==========================================================================

  /** Deterministic pseudo-random in [0,1) from a string seed + index. */
  private rnd(seed: string, i: number): number {
    let h = 2166136261;
    const s = seed + ':' + i;
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  /** Scatter n points inside the tile diamond, avoiding a central keep-out. */
  private scatter(
    seed: string,
    n: number,
    keepOut = 0.42,
    spread = 0.86,
  ): { x: number; y: number; s: number }[] {
    const out: { x: number; y: number; s: number }[] = [];
    for (let i = 0; i < n; i++) {
      // isometric barycentric-ish placement: u,v along the two tile axes
      let u = this.rnd(seed, i * 3) * 2 - 1;
      let v = this.rnd(seed, i * 3 + 1) * 2 - 1;
      const m = Math.abs(u) + Math.abs(v);
      if (m > spread) { u *= spread / m; v *= spread / m; }
      if (m < keepOut) { const k = keepOut / (m || 0.001); u *= k; v *= k; }
      const x = (u + v) * (TILE_W / 4);
      const y = (v - u) * (TILE_H / 4);
      out.push({ x, y, s: 0.8 + this.rnd(seed, i * 3 + 2) * 0.5 });
    }
    return out;
  }

  // ---- FRONT fence only: the two near edges -------------------------------
  // In this isometric projection the two edges meeting at the BOTTOM corner
  // (south) are the near ones. Drawing the back edges too made the fence run
  // across the buildings, which looked wrong — so we only draw the front.

  /** Two rails along the two FRONT edges (left→bottom and bottom→right). */
  perimeterRails(x: number, y: number, inset = 0.9, t = 9): string {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const rail = (dy: number) =>
      `M${x - hw},${y - dy} L${x},${y + hh - dy} L${x + hw},${y - dy}`;
    return `${rail(2)} ${rail(2 + t)}`;
  }
  /** Two rails along the two BACK edges (left→top and top→right). Drawn before
   *  the buildings so the far fence sits behind them, never across them. */
  backRails(x: number, y: number, inset = 0.9, t = 9): string {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const rail = (dy: number) =>
      `M${x - hw},${y - dy} L${x},${y - hh - dy} L${x + hw},${y - dy}`;
    return `${rail(2)} ${rail(2 + t)}`;
  }

  /** Posts along the two FRONT edges only. */
  perimeterPosts(
    x: number,
    y: number,
    inset = 0.9,
    t = 11,
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const left = { x: x - hw, y: y };
    const bottom = { x: x, y: y + hh };
    const right = { x: x + hw, y: y };
    return this.postsAlong([[left, bottom], [bottom, right]], t);
  }
  /** Posts along the two BACK edges only. */
  backPosts(
    x: number,
    y: number,
    inset = 0.9,
    t = 11,
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const left = { x: x - hw, y: y };
    const top = { x: x, y: y - hh };
    const right = { x: x + hw, y: y };
    return this.postsAlong([[left, top], [top, right]], t);
  }

  private postsAlong(
    edges: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[],
    t: number,
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const [a, b] of edges) {
      for (const f of [0, 0.5, 1]) {
        const px = a.x + (b.x - a.x) * f;
        const py = a.y + (b.y - a.y) * f;
        out.push({ x1: px, y1: py - 2, x2: px, y2: py - 2 - t });
      }
    }
    return out;
  }

  /** Four corner columns of an open construction frame. */
  frameColumns(x: number, y: number, w: number): { x: number; y: number }[] {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    return [
      { x: x - hw, y },
      { x, y: y - hh },
      { x: x + hw, y },
      { x, y: y + hh },
    ];
  }
  /** A horizontal ring tying the frame columns at a given height. */
  frameRing(x: number, y: number, w: number, h: number): string {
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    return `M${x - hw},${y - h} L${x},${y - hh - h} L${x + hw},${y - h} L${x},${y + hh - h} Z`;
  }

  // ---- reference-style fence: chunky posts with two horizontal rails -------
  /** Fence posts along an edge, as small upright boxes (not hairlines). */
  fencePostBoxes(
    x: number,
    y: number,
    side: 'front' | 'back',
    inset = 0.92,
    n = 4,
  ): { x: number; y: number }[] {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const left = { x: x - hw, y: y };
    const right = { x: x + hw, y: y };
    const near = side === 'front' ? { x, y: y + hh } : { x, y: y - hh };
    const out: { x: number; y: number }[] = [];
    for (const [a, b] of [[left, near], [near, right]] as const) {
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        // skip the shared corner on the second edge to avoid doubling up
        if (b === right && i === 0) continue;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      }
    }
    return out;
  }
  /** Two horizontal rails spanning an edge pair, at the given heights. */
  fenceRailPath(
    x: number,
    y: number,
    side: 'front' | 'back',
    inset = 0.92,
    heights: number[] = [6, 12],
  ): string {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const nearY = side === 'front' ? y + hh : y - hh;
    return heights
      .map((h) => `M${x - hw},${y - h} L${x},${nearY - h} L${x + hw},${y - h}`)
      .join(' ');
  }

  /** Cube bushes at the plot corners of a villa, as in the reference art. */
  villaBushes(x: number, y: number): { x: number; y: number }[] {
    return [
      { x: x + 34, y: y + 14 },
      { x: x + 14, y: y + 24 },
    ];
  }

  /** A couple of soft bushes — sparse, just enough to feel alive. */
  bushes(seed: string, n = 2): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|bush', n, 0.5, 0.82);
  }
  /** A light sprinkle of grass tufts. Kept deliberately sparse. */
  tufts(seed: string, n = 5): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|tuft', n, 0.05, 0.94);
  }
  /** Stepping-stone path points from the tile's front corner to the house. */
  pathStones(x: number, y: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const t = 0.25 + i * 0.19;
      out.push({ x: x - t * (TILE_W / 2) * 0.55, y: y + (1 - t) * (TILE_H / 2) * 0.8 });
    }
    return out;
  }

  /** Vertical scaffold poles around a construction volume. */
  scaffold(x: number, y: number, h: number): { x1: number; y1: number; x2: number; y2: number }[] {
    const hw = (TILE_W / 2) * 0.56;
    const hh = (TILE_H / 2) * 0.56;
    const corners = [
      { cx: x - hw, cy: y },
      { cx: x, cy: y - hh },
      { cx: x + hw, cy: y },
      { cx: x, cy: y + hh },
    ];
    return corners.map((c) => ({ x1: c.cx, y1: c.cy + 6, x2: c.cx, y2: c.cy + 6 - h - 8 }));
  }
  /** Horizontal scaffold rings at two heights. */
  scaffoldRings(x: number, y: number, h: number): string[] {
    const hw = (TILE_W / 2) * 0.56;
    const hh = (TILE_H / 2) * 0.56;
    const ring = (dy: number) =>
      `M${x - hw},${y + 6 - dy} L${x},${y - hh + 6 - dy} L${x + hw},${y + 6 - dy} L${x},${y + hh + 6 - dy} Z`;
    return [ring(h * 0.45 + 6), ring(h + 6)];
  }
  /** Floor-slab lines showing storeys inside the built volume. */
  floorSlabs(x: number, y: number, h: number, n = 3): string[] {
    const out: string[] = [];
    const hw = (TILE_W / 2) * 0.52;
    const hh = (TILE_H / 2) * 0.52;
    for (let i = 1; i <= n; i++) {
      const dy = (h / (n + 1)) * i;
      out.push(`M${x - hw},${y + 6 - dy} L${x},${y + hh + 6 - dy} L${x + hw},${y + 6 - dy}`);
    }
    return out;
  }

  /** Open centred on the town hall, so the landmark greets you first. */
  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    this.centreOnHall();
    requestAnimationFrame(() => this.centreOnHall());
    // Re-centre the first time the container reports a real size (and on any
    // later resize / rotate), which is more reliable than guessing timings.
    const el = this.scroller?.nativeElement;
    if (el && typeof ResizeObserver !== 'undefined') {
      let settled = false;
      this.ro = new ResizeObserver(() => {
        if (!settled && el.clientWidth > 0) {
          settled = true;
          this.centreOnHall();
        }
      });
      this.ro.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  /** Centre the view on the TOWN — the hall plus whatever has been built — so
   *  the interesting part is always in frame, not a corner of empty grid. */
  private centreOnHall(): void {
    const el = this.scroller?.nativeElement;
    if (!el || !el.clientWidth) return;

    // bounding box (viewBox units) of the hall + every owned tile
    const mid = Math.floor(GRID / 2);
    let minX = 0, maxX = 0, minY = 0, maxY = 0; // hall is at local (0, mid*TILE_H)
    const hallY = (mid + mid) * (TILE_H / 2);
    minY = maxY = hallY;
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

  // ---------------- interaction ----------------
  tapCell(c: Cell): void {
    if (this.gestured) return; // it was a pan/pinch, not a tap
    if (navigator.vibrate) navigator.vibrate(4);
    if (c.tile) {
      // Land has no dedicated page distinct from detail; open detail for built.
      this.openTile.emit(c.tile);
    } else {
      this.buying.set(c);
    }
  }

  /** Confirm buying a tile of the chosen type onto the pending plot. */
  buy(type: TileType, variant: Variant): void {
    const cost = this.costFor(type, variant);
    this.est.addTile({
      type,
      variant,
      cost,
      sipMonthly: type === 'building' ? Math.round(cost / 60) : 0, // ~5yr build
      sipAccrued: type === 'building' ? Math.round(cost * 0.12) : 0, // a little in
      rentMonthly: type === 'villa' ? Math.round((cost * 0.06) / 12) : 0, // ~6%/yr
      label: this.nameFor(),
    });
    this.buying.set(null);
    if (navigator.vibrate) navigator.vibrate([5, 30, 8]);
  }
  cancelBuy(): void {
    this.buying.set(null);
  }

  collect(): void {
    const amt = this.est.collectRent();
    if (amt > 0) {
      this.collected.set(amt);
      if (navigator.vibrate) navigator.vibrate([6, 40, 10]);
      setTimeout(() => this.collected.set(0), 2600);
    }
  }

  // ---------------- helpers ----------------
  private costFor(type: TileType, variant: Variant): number {
    const base = 10_00_000; // ₹10L ticket
    return type === 'villa' ? base * 3 : type === 'building' ? base * 2 : base;
  }
  private readonly localities = [
    'Kelambakkam Grove', 'Siruseri Rise', 'Navalur Court', 'OMR Meadows',
    'Thaiyur Green', 'Padur Vista', 'Mahindra City Edge', 'Guduvancheri Park',
  ];
  private nameFor(): string {
    const used = this.est.tiles().length;
    return this.localities[used % this.localities.length];
  }

  tileEmoji(t: Tile | null): string {
    if (!t) return '';
    return t.type === 'villa' ? '🏡' : t.type === 'building' ? '🏗️' : '🌱';
  }

  compact(v: number): string {
    if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
    if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1).replace(/\.0$/, '')} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }
  full(v: number): string {
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
  }

  get villas(): number { return this.est.countOf('villa'); }
  get buildings(): number { return this.est.countOf('building'); }
  get lands(): number { return this.est.countOf('land'); }
  get open(): number { return this.est.openPlots; }
  get hasAny(): boolean { return this.est.tiles().length > 0; }

  /** Days until next rent (symbolic monthly cycle from purchase). */
  nextRentDays(t: Tile): number {
    const cycle = 30 * 24 * 3600 * 1000;
    const since = (Date.now() - t.boughtAt) % cycle;
    return Math.max(1, Math.ceil((cycle - since) / (24 * 3600 * 1000)));
  }
}
