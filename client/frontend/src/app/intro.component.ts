import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

/** The welcome painted by index.html before any script arrives (see the
 *  inline script there): `mode` is what it chose, `t0` when it started. */
interface BootIntro {
  mode: 'full' | 'quick' | 'none';
  t0: number;
  show(): void;
  leave(): void;
}

/**
 * The opening. The scene itself — a rising sun/horizon behind the "financial
 * freedom" wordmark — is plain HTML/CSS in index.html, so it plays WHILE the
 * app downloads instead of after it. This component only decides when it ends:
 *
 *   full  (first launch)  holds until the wordmark has landed (~1.2s from its
 *                         first frame), then leaves as soon as the app is `ready`
 *   quick (returning)     a brand flash that leaves the moment the home has its
 *                         data (min 350ms, capped 1.6s after boot)
 *
 * Leaving emits `done` (the app draws login/home beneath) and fades the welcome
 * out over it in the same frame — one continuous hand-off, never a gap.
 * Respects prefers-reduced-motion (no hold).
 */
@Component({
  selector: 'app-intro',
  standalone: true,
  template: '',
})
export class IntroComponent implements OnInit, OnDestroy {
  @Output() done = new EventEmitter<void>();
  /** Full cinematic (first-ever launch) vs the quick returning flash. */
  @Input() full = true;
  private _ready = true;
  /** Leave as soon as this is true (e.g. the home's portfolio data is in), so
   *  the first screen paints with real numbers — never a skeleton. */
  @Input() set ready(v: boolean) { this._ready = v; this.tryLeave(); }
  private _hold = false;
  /** While true nothing may end the welcome, not even the cap — the screen
   *  beneath it (the home's code) is not there to be revealed yet. */
  @Input() set hold(v: boolean) { this._hold = v; this.tryLeave(); }

  private leaving = false;
  private minPassed = false;
  private capped = false;
  private timers: number[] = [];

  ngOnInit(): void {
    const boot = (window as { __boot?: BootIntro }).__boot;
    if (!boot) { this.leave(); return; }          // no welcome on the page: straight in
    boot.show();                                  // the HTML skipped it but the app wants one
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const min = reduce ? 0 : this.full ? 1200 : 350;
    const wait = Math.max(0, boot.t0 + min - performance.now());
    this.timers.push(
      window.setTimeout(() => { this.minPassed = true; this.tryLeave(); }, wait),
      // never hold anyone longer than this past boot (data still loading → skeleton)
      window.setTimeout(() => { this.capped = true; this.tryLeave(); }, Math.max(wait, 1600)),
    );
  }

  private tryLeave(): void {
    if (this._hold || !this.minPassed) return;
    if (this._ready || this.capped) this.leave();
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    // Next task (inputs can change mid change-detection): the parent swaps in
    // login/home and the welcome starts fading in the same frame.
    this.timers.push(window.setTimeout(() => {
      (window as { __boot?: BootIntro }).__boot?.leave();
      this.done.emit();
    }));
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    (window as { __boot?: BootIntro }).__boot?.leave();   // never strand the welcome on screen
  }
}
