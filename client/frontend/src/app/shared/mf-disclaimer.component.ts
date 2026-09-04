import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The AMFI-mandated mutual-fund risk disclaimer — but unobtrusive. By default
 * it's a single quiet line ("Subject to market risks — tap for details"); the
 * full disclosure (illustrative figures, read scheme documents) expands only on
 * tap, so it stays present without cluttering the page.
 *
 * NOTE: surfacing this text does not by itself make the product compliant —
 * that depends on ARN/RIA registration, KYC/RTA rails and scheme documents.
 */
@Component({
  selector: 'app-mf-disclaimer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mfd">
      <button class="mfd-toggle" (click)="open.set(!open())" [attr.aria-expanded]="open()">
        <svg class="mfd-i" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
          <path d="M12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
        <span>Subject to market risks</span>
        <svg class="mfd-caret" [class.on]="open()" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div class="mfd-full" *ngIf="open()">
        A villa / plot is a <b>visualisation of mutual-fund units held in your
        name at NAV</b>, not real property. A monthly “payout” is a <b>Systematic
        Withdrawal Plan (SWP)</b> — you are redeeming your own units, which draws
        down your capital and can deplete it. No returns are assured; unit value
        is market-linked and can fall as well as rise.
        <span class="mfd-amfi">Mutual fund investments are subject to market
        risks. Read all scheme related documents carefully.</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mfd { text-align: center; padding-top: 0.4rem; }
    .mfd-toggle {
      display: inline-flex; align-items: center; gap: 0.3rem;
      border: 0; background: none; padding: 0.3rem 0.4rem;
      font: inherit; font-size: 0.68rem; font-weight: 600; color: var(--muted);
      cursor: pointer; opacity: 0.75; transition: opacity 0.2s;
      &:hover { opacity: 1; }
    }
    .mfd-i { flex: none; }
    .mfd-caret { transition: transform 0.25s cubic-bezier(0.22,1,0.36,1); }
    .mfd-caret.on { transform: rotate(180deg); }
    .mfd-full {
      max-width: 340px; margin: 0.35rem auto 0;
      font-size: 0.66rem; line-height: 1.5; color: var(--muted);
      animation: mfd-in 0.25s ease both;
      b { color: var(--ink); font-weight: 800; }
    }
    .mfd-amfi { display: block; margin-top: 0.3rem; font-weight: 700; color: var(--ink); opacity: 0.85; }
    @keyframes mfd-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  `],
})
export class MfDisclaimerComponent {
  /** Kept for API compatibility; the collapsed line is already compact. */
  @Input() compact = false;
  /** Start expanded (e.g. on the home screen so users read it). */
  @Input() set expanded(v: boolean) { this.open.set(v); }
  open = signal(false);
}
