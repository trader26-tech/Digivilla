import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';

import { EstateService, VillaTier } from '../estate.service';
import { VillaArtComponent } from '../shared/villa-art.component';
import { compact } from '../shared/format.util';

/**
 * The Explore page — a dark, premium, full-screen deck of villa tiers.
 *
 * Interaction:
 *   • swipe LEFT / RIGHT (or the dots) → move between villa tiers (₹10L, ₹50L…).
 *   • swipe DOWN-flick isn't used; a deliberate LEFT swipe past the last card,
 *     or the "How it works" affordance, opens the explainer sheet that walks
 *     through how the villa is funded, how it grows, and the rent it pays.
 *
 * Left-swipe specifically opens the explainer for the CURRENT villa (per the
 * brief): horizontal paging is right→left through tiers, and a left-swipe when
 * you're already deciding opens "how it works". To keep both gestures usable we
 * page with left/right and open the explainer with an upward swipe OR the
 * on-card button; the button guarantees discoverability.
 */
@Component({
  selector: 'app-explore',
  standalone: true,
  imports: [CommonModule, VillaArtComponent],
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.scss',
})
export class ExploreComponent implements OnInit {
  /** Ask the shell to book a setup call to actually own this villa. */
  @Output() own = new EventEmitter<VillaTier>();
  @Output() back = new EventEmitter<void>();

  private est = inject(EstateService);
  compact = compact;

  tiers = signal<VillaTier[]>([]);
  idx = signal(0);
  loading = signal(true);

  /** Selected point on the growth timeline. */
  years = signal<5 | 10 | 15 | 20>(20);
  readonly YEAR_STOPS: (5 | 10 | 15 | 20)[] = [5, 10, 15, 20];

  /** The "how it works" explainer sheet. */
  explainerOpen = signal(false);

  ngOnInit(): void {
    this.est.catalog().subscribe({
      next: (r) => {
        // Only villas priced ₹10L and up — the two tiers the brief asks for
        // (₹10L, ₹50L) come straight from the real catalog.
        const list = (r.villas || []).filter((v) => v.price >= 10_00_000);
        this.tiers.set(list.length ? list : (r.villas || []));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  get current(): VillaTier | null { return this.tiers()[this.idx()] ?? null; }
  get count(): number { return this.tiers().length; }

  /** Projected value of the current villa at the selected year. */
  projected(): number {
    const v = this.current;
    return v ? (v.projection[String(this.years())] ?? v.price) : 0;
  }
  /** Multiple vs. the ticket at the selected year (e.g. 8.1×). */
  multiple(): number {
    const v = this.current;
    if (!v || !v.price) return 0;
    return Math.round((this.projected() / v.price) * 10) / 10;
  }

  go(i: number): void {
    const n = this.count;
    if (!n) return;
    this.idx.set(((i % n) + n) % n);
    if (navigator.vibrate) navigator.vibrate(4);
  }
  step(dir: 1 | -1): void { this.go(this.idx() + dir); }
  pickYear(y: 5 | 10 | 15 | 20): void { this.years.set(y); if (navigator.vibrate) navigator.vibrate(3); }

  openExplainer(): void { this.explainerOpen.set(true); if (navigator.vibrate) navigator.vibrate(6); }
  closeExplainer(): void { this.explainerOpen.set(false); }

  ownThis(): void { const v = this.current; if (v) this.own.emit(v); }

  // ---- swipe: VERTICAL pages villas (up = next, down = prev); LEFT = details ----
  private sx: number | null = null;
  private sy: number | null = null;
  onDown(e: PointerEvent): void {
    this.sx = e.clientX; this.sy = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  }
  onUp(e: PointerEvent): void {
    if (this.sx === null || this.sy === null) return;
    const dx = e.clientX - this.sx;
    const dy = e.clientY - this.sy;
    this.sx = this.sy = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ay >= ax) {
      // vertical: swipe UP → next villa, swipe DOWN → previous villa
      if (ay > 45) this.step(dy < 0 ? 1 : -1);
      return;
    }
    // horizontal: a LEFT swipe opens the explainer (the "how it works" details)
    if (dx < -45) this.openExplainer();
  }

  /** Desktop: scroll wheel pages villas up/down — throttled so one flick moves
   *  exactly one villa (a trackpad fires dozens of events per gesture). */
  private wheelLock = 0;
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaY) < 8) return;
    e.preventDefault();
    const now = Date.now();
    if (now - this.wheelLock < 500) return;   // ignore until the flick settles
    this.wheelLock = now;
    this.step(e.deltaY > 0 ? 1 : -1);
  }

  /** A plain-language, historical "what if" line for the current villa. Uses
   *  the villa's own growth assumption over 17 years so it reads concretely. */
  get historicalLine(): { years: number; worth: string; rent: string } | null {
    const v = this.current;
    if (!v) return null;
    const years = 17;
    const worth = Math.round(v.price * Math.pow(1 + (v.growth_rate || 0.12), years));
    return { years, worth: compact(worth), rent: compact(v.monthly_income) };
  }

  /** How the fund weight reads as a role label. */
  roleWord(role: string): string {
    return role === 'income' ? 'Monthly income' : role === 'liquid' ? 'Safety buffer'
      : role === 'hedge' ? 'Hedge' : 'Long-term growth';
  }
}
