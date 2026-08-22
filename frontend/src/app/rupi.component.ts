import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/** Rupi's mood, which changes the eyes/mouth and a little pose. */
export type RupiPose = 'wave' | 'happy' | 'point' | 'think' | 'cheer';

/**
 * Rupi — the app's guide mascot: a friendly gold ₹ coin with eyes, a smile and
 * little arms. Reused across the onboarding flow as a consistent companion.
 *
 * Pure inline SVG so it's crisp at any size, themeable, and animatable with
 * CSS. `pose` drives the expression; `size` sets the pixel width.
 */
@Component({
  selector: 'app-rupi',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rupi.component.html',
  styleUrl: './rupi.component.scss',
})
export class RupiComponent {
  @Input() pose: RupiPose = 'happy';
  @Input() size = 120;
  /** Adds the gentle idle bob + blink loop. */
  @Input() animated = true;
}
