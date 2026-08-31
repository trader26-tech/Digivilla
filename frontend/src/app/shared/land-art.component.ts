import { Component } from '@angular/core';

/**
 * The one true land image — the SAME ground the villa art draws (same 640-scale
 * coords, same viewBox), just without the house, so a plot and a villa read at
 * exactly the same size and sharpness. Clean plot, sharp edges, no scattered
 * tufts.
 */
@Component({
  selector: 'app-land-art',
  standalone: true,
  template: `
    <svg
      class="land-art"
      viewBox="88 60 644 468"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Land plot"
    >
      <!-- soil sides (same as the villa ground) -->
      <polygon points="721.8,264 410,444 410,516 721.8,336" fill="#8a5a33"></polygon>
      <polygon points="410,444 98.2,264 98.2,336 410,516" fill="#6d4527"></polygon>
      <polygon points="721.8,264 410,444 410,458 721.8,278" fill="#3f2a18" opacity="0.35"></polygon>
      <!-- grass edge (the lip between grass top and soil) -->
      <polygon points="721.8,250 410,430 410,444 721.8,264" fill="#59a52e"></polygon>
      <polygon points="410,430 98.2,250 98.2,264 410,444" fill="#3f7a20"></polygon>
      <!-- grass top — clean, sharp iso plot -->
      <polygon points="410,70 721.8,250 410,430 98.2,250" fill="#6cba36"></polygon>
      <!-- the same thick crisp outline the villa ground uses -->
      <polygon points="410,70 721.8,250 410,430 98.2,250" fill="none" stroke="#3f7a20" stroke-width="8"></polygon>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .land-art { display: block; width: 100%; height: 100%; }
  `],
})
export class LandArtComponent {}
