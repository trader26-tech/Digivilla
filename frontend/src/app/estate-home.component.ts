import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  EventEmitter,
  Output,
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
  index: number;
}

/** Isometric tile footprint. Tuned so 9 plots fit a 3×3 board that pans. */
const TILE_W = 128;   // full diamond width
const TILE_H = 64;    // full diamond height
const COLS = 3;
const ROWS = 3;

@Component({
  selector: 'app-estate-home',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './estate-home.component.html',
  styleUrl: './estate-home.component.scss',
})
export class EstateHomeComponent {
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

  /** The board cells: fill owned tiles into a stable grid, rest are open. */
  cells = computed<Cell[]>(() => {
    const tiles = this.est.tiles();
    const out: Cell[] = [];
    let i = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        out.push({
          col,
          row,
          x: (col - row) * (TILE_W / 2),
          y: (col + row) * (TILE_H / 2),
          tile: tiles[i] ?? null,
          index: i,
        });
        i++;
      }
    }
    return out;
  });

  /** SVG viewBox sized to the board plus margin for raised structures. */
  get boardW(): number {
    return (COLS + ROWS) * (TILE_W / 2) + 40;
  }
  get boardH(): number {
    return (COLS + ROWS) * (TILE_H / 2) + 140; // extra headroom for tall villas
  }
  /** Shift so the leftmost diamond isn't clipped. */
  get offX(): number {
    return (ROWS - 1) * (TILE_W / 2) + 20;
  }
  get offY(): number {
    return 90; // room above for coins / villa roofs
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

  /** Tree / bush cluster placements for a tile. */
  trees(seed: string, n = 5): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|tree', n, 0.5, 0.9);
  }
  /** Small grass tufts sprinkled across the lawn. */
  tufts(seed: string, n = 10): { x: number; y: number; s: number }[] {
    return this.scatter(seed + '|tuft', n, 0.15, 0.92);
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
