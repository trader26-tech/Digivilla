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
      <!-- soil sides -->
      <polygon points="213.6,84 120,138 120,159.6 213.6,105.6" fill="#8a5a33"></polygon>
      <polygon points="120,138 26.4,84 26.4,105.6 120,159.6" fill="#6d4527"></polygon>
      <!-- grass edge (the lip between grass top and soil) -->
      <polygon points="213.6,80 120,134 120,138 213.6,84" fill="#59a52e"></polygon>
      <polygon points="120,134 26.4,80 26.4,84 120,138" fill="#3f7a20"></polygon>
      <!-- grass top -->
      <polygon points="120,26 213.6,80 120,134 26.4,80" fill="#6cba36"></polygon>
      <!-- a soft lighter highlight on the sunlit (right) half of the grass -->
      <polygon points="120,26 213.6,80 120,134" fill="#78c644" opacity="0.55"></polygon>
      <!-- scattered grass tufts for texture (same idiom as the villa art) -->
      <polygon points="150,58 156.5,61.75 150,65.5 143.5,61.75" fill="#4b8f26" opacity="0.8"></polygon>
      <polygon points="120,74 126.5,77.75 120,81.5 113.5,77.75" fill="#4b8f26" opacity="0.8"></polygon>
      <polygon points="90,90 96.5,93.75 90,97.5 83.5,93.75" fill="#4b8f26" opacity="0.8"></polygon>
      <polygon points="168,86 174.5,89.75 168,93.5 161.5,89.75" fill="#3f7a20" opacity="0.7"></polygon>
      <polygon points="140,100 146.5,103.75 140,107.5 133.5,103.75" fill="#3f7a20" opacity="0.7"></polygon>
      <polygon points="110,110 116.5,113.75 110,117.5 103.5,113.75" fill="#4b8f26" opacity="0.75"></polygon>
      <!-- crisp outline -->
      <polygon points="120,26 213.6,80 120,134 26.4,80" fill="none" stroke="#3f7a20" stroke-width="2.5"></polygon>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .land-art { display: block; width: 100%; height: 100%; }
  `],
})
export class LandArtComponent {}
