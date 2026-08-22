import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

/** One swipeable story card. `scene` names the CSS/SVG illustration. */
export interface StoryCard {
  scene: string;
  kicker: string;
  title: string;
  body: string;
  stat?: { value: string; label: string };
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
      scene: 'coffee',
      kicker: 'A small habit',
      title: 'Skip one coffee a day. Retire richer.',
      body: 'Meera set aside what she spent on her daily ₹150 coffee — into mutual funds instead of the café. Thirty years on, that little habit had quietly grown into over ₹1 crore. She never felt the pinch; time did the heavy lifting.',
      stat: { value: '₹1 Cr+', label: 'from ₹150 a day, over 30 years' },
      hue: 28,
    },
    {
      scene: 'umbrella',
      kicker: 'When life happens',
      title: 'The rainy day that didn’t sink him.',
      body: 'When Arjun’s job vanished overnight, he didn’t panic. A safety cushion — a few months of expenses kept aside — carried the family calmly until he found his footing. A buffer isn’t about fear. It’s the freedom to breathe.',
      stat: { value: '6–12 months', label: 'of calm, whatever comes' },
      hue: 205,
    },
    {
      scene: 'compass',
      kicker: 'Why us',
      title: 'Advice that’s only ever on your side.',
      body: 'We earn nothing from pushing the “right” fund, so we never do. Every recommendation is researched on returns, risk and cost — then stress-tested across thousands of market scenarios, so you see the real odds of reaching your goal, not a rosy line.',
      stat: { value: '0', label: 'commissions clouding our advice' },
      hue: 150,
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
