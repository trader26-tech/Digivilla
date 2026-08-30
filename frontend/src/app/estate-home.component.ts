import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit,
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
export class EstateHomeComponent implements AfterViewInit {
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

  /** Zoom: 1 = default (about nine tiles fill the view). Clamped both ways so
   *  the town never gets uselessly tiny or absurdly huge. */
  readonly MIN_ZOOM = 0.55;
  readonly MAX_ZOOM = 2.2;
  zoom = signal(1);

  zoomIn(): void {
    this.zoom.update((z) => Math.min(this.MAX_ZOOM, +(z * 1.25).toFixed(3)));
    setTimeout(() => this.centreOnHall(), 0);
  }
  zoomOut(): void {
    this.zoom.update((z) => Math.max(this.MIN_ZOOM, +(z / 1.25).toFixed(3)));
    setTimeout(() => this.centreOnHall(), 0);
  }
  get canZoomIn(): boolean { return this.zoom() < this.MAX_ZOOM - 0.001; }
  get canZoomOut(): boolean { return this.zoom() > this.MIN_ZOOM + 0.001; }

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
    all.sort((p, q) => (p.d - q.d) || (p.a - q.a));

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
  private readonly ZOOM_BASE = 1.12;
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

  // ---- perimeter fence: posts + rails around the whole plot ----------------
  /** Rails around all four edges of a tile, at the given height. */
  perimeterRails(x: number, y: number, inset = 0.88, t = 10): string {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const ring = (dy: number) =>
      `M${x - hw},${y - dy} L${x},${y - hh - dy} L${x + hw},${y - dy} L${x},${y + hh - dy} Z`;
    return `${ring(2)} ${ring(2 + t)}`;
  }
  /** Fence posts spaced around all four edges. */
  perimeterPosts(
    x: number,
    y: number,
    inset = 0.88,
    t = 12,
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const hw = (TILE_W / 2) * inset;
    const hh = (TILE_H / 2) * inset;
    const corners = [
      { x: x - hw, y: y },
      { x: x, y: y - hh },
      { x: x + hw, y: y },
      { x: x, y: y + hh },
    ];
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      for (const f of [0, 0.5]) {
        const px = a.x + (b.x - a.x) * f;
        const py = a.y + (b.y - a.y) * f;
        out.push({ x1: px, y1: py - 2, x2: px, y2: py - 2 - t });
      }
    }
    return out;
  }

  /** Column positions across the town hall's two visible faces. */
  hallColumns(x: number, y: number): { x: number; y: number }[] {
    const w = 0.54;
    const hw = (TILE_W / 2) * w;
    const hh = (TILE_H / 2) * w;
    const out: { x: number; y: number }[] = [];
    for (const f of [0.12, 0.34, 0.56, 0.78]) {
      // left face: from left corner toward centre
      out.push({ x: x - hw + hw * f, y: y + hh * f });
      // right face: from centre toward right corner
      out.push({ x: x + hw * f, y: y + hh * (1 - f) });
    }
    return out;
  }

  /** Cube bushes at the plot corners of a villa, as in the reference art. */
  villaBushes(x: number, y: number): { x: number; y: number }[] {
    return [
      { x: x + 40, y: y + 4 },
      { x: x + 26, y: y + 16 },
      { x: x - 8, y: y + 22 },
    ];
  }

  /** A couple of soft bushes — sparse, just enough to feel alive. */
  bushes(seed: string, n = 2): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|bush', n, 0.5, 0.82);
  }
  /** A light sprinkle of grass tufts. Kept deliberately sparse. */
  tufts(seed: string, n = 5): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|tuft', n, 0.2, 0.88);
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
  ngAfterViewInit(): void {
    this.centreOnHall();
    // re-centre once layout has settled (fonts/sizing can shift it)
    setTimeout(() => this.centreOnHall(), 0);
  }

  private centreOnHall(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const mid = Math.floor(GRID / 2);
    // hall centre in viewBox units, then converted to rendered pixels
    const hallX = (this.offX) * this.scale;
    const hallY = (this.offY + (mid + mid) * (TILE_H / 2)) * this.scale;
    el.scrollLeft = Math.round(hallX - el.clientWidth / 2);
    el.scrollTop = Math.round(hallY - el.clientHeight / 2);
  }

  // ---------------- interaction ----------------
  tapCell(c: Cell): void {
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
