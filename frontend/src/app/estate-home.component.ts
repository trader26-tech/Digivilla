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
