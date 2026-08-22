import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

import { RupiComponent, RupiPose } from './rupi.component';

/** One beat of Rupi's welcome: a pose + a single spoken line. */
export interface RupiBeat {
  pose: RupiPose;
  line: string; // ONE short line, spoken by Rupi
  hue: number;
}

/**
 * The app's warm opening: Rupi, the guide mascot, introduces herself and
 * explains how the app works — one friendly line at a time — then hands off to
 * the goal picker. No walls of text, no jargon: Rupi just talks to you.
 */
@Component({
  selector: 'app-story',
  standalone: true,
  imports: [CommonModule, RupiComponent],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
  animations: [
    trigger('bubbleSwap', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateY(10px) scale(0.96)' }),
        animate('360ms cubic-bezier(0.22,1,0.36,1)', style({ opacity: 1, transform: 'translateY(0) scale(1)' })),
      ]),
    ]),
  ],
})
export class StoryComponent {
  /** Emitted when Rupi's intro finishes (or is skipped) -> show goal picker. */
  @Output() done = new EventEmitter<void>();

  index = 0;

  /** Rupi speaks these in order — a natural welcome, not a lecture. */
  readonly beats: RupiBeat[] = [
    { pose: 'wave', line: 'Hi, I’m Rupi — your money guide.', hue: 28 },
    { pose: 'happy', line: 'Tell me a dream. A home, a trip, retiring easy.', hue: 262 },
    { pose: 'think', line: 'I’ll turn it into a simple monthly plan.', hue: 205 },
    { pose: 'cheer', line: 'Ready? Let’s pick your first goal.', hue: 150 },
  ];

  get beat(): RupiBeat {
    return this.beats[this.index];
  }
  get isLast(): boolean {
    return this.index === this.beats.length - 1;
  }

  next(): void {
    if (this.isLast) {
      this.done.emit();
      return;
    }
    this.index++;
  }
  prev(): void {
    if (this.index > 0) this.index--;
  }
  skip(): void {
    this.done.emit();
  }

  // ---- keyboard + touch swipe ---------------------------------------------
  @HostListener('keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      this.prev();
    }
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
