import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * "What these represent" — a plain-language key that maps each asset picture on
 * the estate to the real mutual-fund category it stands for, so a user is never
 * left thinking they own physical property or land.
 *
 *   Villa  → income-oriented funds (hybrid / arbitrage / debt) — aim for a
 *            regular payout via an SWP
 *   Plot   → equity growth funds — pure appreciation, no payout
 *   Build  → a SIP building toward a villa
 *
 * Collapsed to a single tappable line by default; expands to the full key.
 */
@Component({
  selector: 'app-asset-key',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ak">
      <!-- ALWAYS-VISIBLE truth line — the metaphor is never left unexplained -->
      <button class="ak-toggle" (click)="open.set(!open())" [attr.aria-expanded]="open()">
        <svg class="ak-i" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
          <path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
        <span>An estate view of your <b>mutual funds</b> — not real property. What each stands for</span>
        <svg class="ak-caret" [class.on]="open()" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div class="ak-body" *ngIf="open()">
        <div class="ak-row">
          <span class="ak-ico villa" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 11l8-7 8 7M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </span>
          <span class="ak-txt"><b>Villa</b> — income-oriented funds (hybrid, arbitrage or debt). Any monthly income is a Systematic Withdrawal Plan from your own units.</span>
        </div>
        <div class="ak-row">
          <span class="ak-ico land" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 13l9-5 9 5-9 5-9-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </span>
          <span class="ak-txt"><b>Land / Plot</b> — equity growth funds. Aims for capital appreciation only; no payout.</span>
        </div>
        <div class="ak-row">
          <span class="ak-ico build" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 20V9l8-5 8 5v11M4 20h16M9 20v-5h6v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </span>
          <span class="ak-txt"><b>Under construction</b> — a SIP steadily building toward a villa.</span>
        </div>
        <p class="ak-foot">
          The estate is a <b>visualisation only</b>. You hold units of mutual-fund schemes at NAV in your
          name — not real property or land. Values are market-linked and not guaranteed.
        </p>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ak { text-align: center; }
    .ak-toggle {
      display: inline-flex; align-items: center; gap: 0.35rem;
      border: 0; background: none; padding: 0.3rem 0.5rem;
      font: inherit; font-size: 0.7rem; font-weight: 600; color: var(--muted);
      cursor: pointer; opacity: 0.8; transition: opacity 0.2s; line-height: 1.3;
      &:hover { opacity: 1; }
    }
    .ak-i { flex: none; }
    .ak-caret { flex: none; transition: transform 0.25s cubic-bezier(0.22,1,0.36,1); }
    .ak-caret.on { transform: rotate(180deg); }
    .ak-body {
      max-width: 360px; margin: 0.5rem auto 0;
      padding: 0.85rem 1rem;
      border-radius: 14px; border: 1px solid var(--survey); background: #fff;
      box-shadow: 0 12px 28px -20px rgba(22, 48, 43, 0.5);
      text-align: left;
      animation: ak-in 0.25s ease both;
    }
    @keyframes ak-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .ak-row { display: flex; align-items: flex-start; gap: 0.6rem; margin-bottom: 0.7rem; }
    .ak-ico {
      flex: none; width: 34px; height: 34px; border-radius: 10px;
      display: grid; place-items: center;
    }
    .ak-ico.villa { background: rgba(46, 107, 79, 0.12); color: var(--positive); }
    .ak-ico.land  { background: rgba(60, 127, 168, 0.12); color: #3c7fa8; }
    .ak-ico.build { background: rgba(166, 124, 46, 0.14); color: var(--brass); }
    .ak-txt { font-size: 0.76rem; line-height: 1.4; color: var(--muted); b { color: var(--ink); font-weight: 800; } }
    .ak-foot {
      margin: 0.4rem 0 0; padding-top: 0.6rem; border-top: 1px solid var(--survey);
      font-size: 0.72rem; line-height: 1.45; color: var(--muted); b { color: var(--ink); font-weight: 800; }
    }
  `],
})
export class AssetKeyComponent {
  open = signal(false);
}
