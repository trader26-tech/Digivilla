import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

/**
 * Cinematic welcome shown on every PWA launch (~2.4s), then it fades and
 * reveals the goal screen. Pure CSS/SVG animation — a rising sun/horizon
 * scene behind an animated "financial freedom" wordmark. Respects
 * prefers-reduced-motion by finishing near-instantly.
 */
@Component({
  selector: 'app-intro',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './intro.component.html',
  styleUrl: './intro.component.scss',
})
export class IntroComponent implements OnInit, OnDestroy {
  @Output() done = new EventEmitter<void>();

  leaving = false;
  private timers: number[] = [];

  ngOnInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const hold = reduce ? 500 : 2400;
    this.timers.push(
      window.setTimeout(() => (this.leaving = true), hold),
      // let the exit transition play before we tell the parent to swap views
      window.setTimeout(() => this.done.emit(), hold + 650),
    );
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }
}
