import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { Tile } from './estate.service';
import { TILE_W, TILE_H } from './estate/iso.model';
import * as iso from './estate/iso-draw';

/**
 * One estate tile's artwork — soil skirt, lawn, and the villa / building /
 * land drawing — rendered at a given centre.
 *
 * Extracted so the SAME art appears on the map and in the detail popup. It
 * emits only the <g> contents (no <svg>, no gradients); the host supplies the
 * SVG, its viewBox, and the #lawn / #soil / #wall gradient defs.
 */
@Component({
  selector: '[app-tile-art]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tile-art.component.html',
})
export class TileArtComponent {
  /** The asset to draw. */
  @Input({ required: true }) tile!: Tile;
  /** Centre of the tile in the host SVG's coordinate space. */
  @Input() cx = 0;
  @Input() cy = 0;

  readonly TILE_W = TILE_W;
  readonly TILE_H = TILE_H;

  // pass-throughs the template needs
  diamond = iso.diamond;
  boxLeft = iso.boxLeft;
  boxRight = iso.boxRight;
  boxTop = iso.boxTop;
  fenceRailPath = iso.fenceRailPath;
  fencePostBoxes = iso.fencePostBoxes;
}
