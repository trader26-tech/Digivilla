/**
 * Board layout: where each parcel sits, which parcel gets filled next, and how
 * big the SVG canvas needs to be.
 *
 * Pure functions of (owned tile count) -> geometry, so the component only has
 * to render what this returns.
 */

import { Tile } from '../estate.service';
import { BASE_GRID, TILE_W, TILE_H } from './iso.model';

/** One cell of the board. */
export interface Cell {
  col: number;
  row: number;
  /** Centre in board space. */
  x: number;
  y: number;
  /** The asset built here, or null for an open plot. */
  tile: Tile | null;
  /** Position in the fill order; -1 for the hall. */
  index: number;
  /** True for the single town-hall cell at the centre. */
  hall: boolean;
}

/** Headroom above the topmost tile centre for the hall tower and roofs. */
export const TOP_PAD = 96;
/** Skirt below the bottom tile for the soil depth. */
export const BOT_PAD = 40;

/**
 * How many cells per side. Stays at the base 3x3 until the user owns more
 * plots than that ring can hold, then steps up two at a time — so the view
 * only ever expands because the town genuinely outgrew it.
 */
export function gridSize(ownedCount: number): number {
  let g = BASE_GRID;
  while (g * g - 1 < ownedCount) g += 2;
  return g;
}

/**
 * Which plot gets built on next.
 *
 * Ordered by: ring distance from the hall (tight clusters, no scattering),
 * then front-most first within a ring (the hall is the tallest thing on the
 * board, so a build behind it would be hidden).
 *
 * Cell (0,0) is special-cased to LAST: it shares the hall's x and renders
 * highest on screen, so anything there — and anything floating above it —
 * reads as perched on top of the hall's tower.
 */
function fillOrder(grid: number): { col: number; row: number }[] {
  const mid = Math.floor(grid / 2);
  const cells: { col: number; row: number; ring: number; angle: number }[] = [];

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      if (col === mid && row === mid) continue; // reserved for the hall
      const dc = col - mid;
      const dr = row - mid;
      cells.push({
        col,
        row,
        ring: Math.max(Math.abs(dc), Math.abs(dr)),
        angle: Math.atan2(dr, dc),
      });
    }
  }

  const aboveHall = (c: { col: number; row: number }) => c.col === 0 && c.row === 0;

  cells.sort((p, q) => {
    const pa = aboveHall(p) ? 1 : 0;
    const qa = aboveHall(q) ? 1 : 0;
    if (pa !== qa) return pa - qa;              // the hidden cell goes last
    if (p.ring !== q.ring) return p.ring - q.ring;
    const pf = p.col + p.row;
    const qf = q.col + q.row;
    if (pf !== qf) return qf - pf;              // front-most first
    return p.angle - q.angle;
  });

  return cells.map(({ col, row }) => ({ col, row }));
}

/**
 * Build every cell of the board, with owned tiles assigned in fill order and
 * the result sorted back-to-front for painting (SVG has no z-buffer, so
 * document order IS depth — a back cell emitted late would paint over the
 * cell in front of it).
 */
export function buildCells(tiles: Tile[]): Cell[] {
  const grid = gridSize(tiles.length);
  const mid = Math.floor(grid / 2);
  const out: Cell[] = [];

  // the hall, dead centre
  out.push({
    col: mid,
    row: mid,
    x: 0,
    y: mid * TILE_H,
    tile: null,
    index: -1,
    hall: true,
  });

  fillOrder(grid).forEach(({ col, row }, i) => {
    out.push({
      col,
      row,
      x: (col - row) * (TILE_W / 2),
      y: (col + row) * (TILE_H / 2),
      tile: tiles[i] ?? null,
      index: i,
      hall: false,
    });
  });

  out.sort((p, q) => p.col + p.row - (q.col + q.row));
  return out;
}

/** Intrinsic canvas size for a board of this many cells per side. */
export function boardSize(grid: number): { w: number; h: number } {
  return {
    w: grid * TILE_W + 24,               // small side margin for the fences
    h: grid * TILE_H + TOP_PAD + BOT_PAD,
  };
}

/** Translation that puts the board's leftmost tile inside the canvas. */
export function boardOrigin(grid: number): { x: number; y: number } {
  return {
    x: (grid - 1) * (TILE_W / 2) + TILE_W / 2 + 12,
    y: TOP_PAD,
  };
}
