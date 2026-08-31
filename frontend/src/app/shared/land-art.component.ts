import { Component } from '@angular/core';

/**
 * The one true land image — the exact isometric plot the estate map paints,
 * lifted verbatim from the map's #tLand symbol so the detail page and the map
 * stay identical. Single source of truth for the land art.
 *
 * Authored around the map's local origin (120,80); the viewBox hugs the
 * diamond (x 26→214, y 26→160).
 */
@Component({
  selector: 'app-land-art',
  standalone: true,
  template: `
    <svg
      class="land-art"
      viewBox="20 20 200 146"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Land plot"
    >
      <polygon points="213.6,84 120,138 120,159.6 213.6,105.6" fill="#8a5a33"></polygon>
      <polygon points="120,138 26.4,84 26.4,105.6 120,159.6" fill="#6d4527"></polygon>
      <polygon points="213.6,80 120,134 120,138 213.6,84" fill="#59a52e"></polygon>
      <polygon points="120,134 26.4,80 26.4,84 120,138" fill="#3f7a20"></polygon>
      <polygon points="120,26 213.6,80 120,134 26.4,80" fill="#6cba36"></polygon>
      <polygon points="120,26 213.6,80 120,134 26.4,80" fill="none" stroke="#3f7a20" stroke-width="2.5"></polygon>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .land-art { display: block; width: 100%; height: 100%; }
  `],
})
export class LandArtComponent {}
