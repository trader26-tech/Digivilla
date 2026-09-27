import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

/**
 * Cinematic welcome on the FIRST launch (~2.4s); later launches get a quick
 * brand flash that ends as soon as the home data is ready, then it fades and
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
  /** Full cinematic (first-ever launch). Otherwise a quick brand flash that
   *  leaves as soon as the app is `ready` (min 350ms, capped at 1.6s). */
  @Input() full = true;
  private _ready = true;
  /** Quick mode waits for this (e.g. the home's portfolio data) before leaving,
   *  so the first screen paints with real numbers — never a skeleton. */
  @Input() set ready(v: boolean) { this._ready = v; this.tryLeave(); }

  leaving = false;
  private minPassed = false;
  private timers: number[] = [];

  ngOnInit(): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.full) {
      this.timers.push(window.setTimeout(() => this.leave(), reduce ? 500 : 2400));
      return;
    }
    this.timers.push(
      window.setTimeout(() => { this.minPassed = true; this.tryLeave(); }, reduce ? 0 : 350),
      window.setTimeout(() => this.leave(), 1600),   // never hold a returning user longer
    );
  }

  private tryLeave(): void {
    if (!this.full && this.minPassed && this._ready) this.leave();
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    // let the exit transition play before we tell the parent to swap views
    this.timers.push(window.setTimeout(() => this.done.emit(), this.full ? 650 : 280));
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }
}
