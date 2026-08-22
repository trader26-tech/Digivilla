import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';

/**
 * The bold welcome hero shown after the intro animation, before the goal
 * picker. One striking full-screen moment — animated growth visual + a single
 * headline + one CTA into "Choose a goal". No mascot, no swiping.
 */
@Component({
  selector: 'app-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent {
  /** Emitted when the user taps Get started -> show the goal picker. */
  @Output() done = new EventEmitter<void>();

  start(): void {
    this.done.emit();
  }
}
