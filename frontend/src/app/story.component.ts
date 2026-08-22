import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

/** One swipeable story card — a single big idea, no paragraphs. */
export interface StoryCard {
  scene: string;
  step: string; // tiny step marker, e.g. "Step 1"
  title: string; // ONE line only
  hue: number;
}

/**
 * The first real content a visitor sees (after the welcome animation): a short,
 * playful set of swipeable story cards that make investing feel relatable and
 * build trust in the platform — then it flows into the goal picker.
 *
 * Relatable > technical: each card tells a tiny human story, not a lecture.
 */
@Component({
  selector: 'app-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
  animations: [
    // Re-runs whenever `index` changes: the new card slides in from the side
    // the user is heading (dir drives the CSS class, this drives the motion).
    trigger('cardSwap', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateX({{enter}}) scale(0.98)' }),
        animate('460ms cubic-bezier(0.22,1,0.36,1)', style({ opacity: 1, transform: 'translateX(0) scale(1)' })),
      ], { params: { enter: '34px' } }),
    ]),
  ],
})
export class StoryComponent {
  /** Emitted when the user finishes (or skips) the story -> show goal picker. */
  @Output() done = new EventEmitter<void>();

  index = 0;
  /** Slide direction for the enter/leave animation: 1 forward, -1 back. */
  dir = 1;

  readonly cards: StoryCard[] = [
    {
      scene: 'umbrella',
      step: 'Step 1',
      title: 'First, a safety net for tough days.',
      hue: 205,
    },
    {
      scene: 'sprout',
      step: 'Step 2',
      title: 'Then grow your money with mutual funds.',
      hue: 150,
    },
    {
      scene: 'compass',
      step: 'Step 3',
      title: 'We build the plan. You just pick a goal.',
      hue: 28,
    },
  ];

  get card(): StoryCard {
    return this.cards[this.index];
  }
  get isLast(): boolean {
    return this.index === this.cards.length - 1;
  }

  next(): void {
    if (this.isLast) {
      this.done.emit();
      return;
    }
    this.dir = 1;
    this.index++;
  }

  prev(): void {
    if (this.index === 0) return;
    this.dir = -1;
    this.index--;
  }

  goTo(i: number): void {
    if (i === this.index) return;
    this.dir = i > this.index ? 1 : -1;
    this.index = i;
  }

  skip(): void {
    this.done.emit();
  }

  // ---- keyboard + touch swipe ---------------------------------------------
  @HostListener('keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight' || e.key === 'Enter') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
  }

  private touchX: number | null = null;
  onTouchStart(e: TouchEvent): void {
    this.touchX = e.changedTouches[0]?.clientX ?? null;
  }
  onTouchEnd(e: TouchEvent): void {
    if (this.touchX == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? this.touchX) - this.touchX;
    if (Math.abs(dx) > 45) (dx < 0 ? this.next() : this.prev());
    this.touchX = null;
  }
}
