/**
 * Shared geometry for the isometric estate board.
 *
 * One fixed 2:1 isometric diamond. A tile of half-width HW and half-height HH
 * centred at (cx, cy) has corners:
 *   top (cx, cy-HH) · right (cx+HW, cy) · bottom (cx, cy+HH) · left (cx-HW, cy)
 *
 * Height is a pure vertical offset — to raise a face by h, subtract h from
 * every y. Never rotate, never skew.
 */

/** Full diamond width (half-width is TILE_W / 2 = 93.6). */
export const TILE_W = 187.2;
/** Full diamond height (half-height is TILE_H / 2 = 54). The 1.733:1 ratio
 *  between the halves must hold or the tiles will not tessellate. */
export const TILE_H = 108;

/** The board starts as a fixed 3x3 — nine parcels in one comprehensive view. */
export const BASE_GRID = 3;

/** A point in board space. */
export interface Pt {
  x: number;
  y: number;
}

/** A vertical segment, used for fence posts and columns. */
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Which pair of tile edges a fence run covers. The two edges meeting at the
 *  BOTTOM corner are nearest the viewer ('front'); the two meeting at the TOP
 *  corner are furthest ('back'). Drawing the back run before the buildings and
 *  the front run after keeps a fence from crossing a house. */
export type FenceSide = 'front' | 'back';
