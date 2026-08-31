import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The AMFI-mandated mutual-fund risk disclaimer, plus a short note that the
 * "villa / rent / growth" figures shown across the app are ILLUSTRATIVE, not
 * guaranteed. Drop this on every money-facing screen.
 *
 * IMPORTANT: this component only surfaces the standard disclosure text. It does
 * NOT by itself make the product compliant — that depends on the entity's
 * ARN/RIA registration, KYC/RTA rails, and scheme documents, which are outside
 * the frontend.
 */
@Component({
  selector: 'app-mf-disclaimer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="mfd" [class.compact]="compact">
      <span class="mfd-line">
        Figures shown (rent, growth, projected worth) are <b>illustrative,
        not guaranteed</b> — actual returns are market-linked and may be lower,
        or negative. Assets are a metaphor for units of a mutual fund portfolio
        held in your name, valued at NAV.
      </span>
      <span class="mfd-amfi">
        Mutual fund investments are subject to market risks. Read all scheme
        related documents carefully.
      </span>
    </p>
  `,
  styles: [`
    :host { display: block; }
    .mfd {
      margin: 0; padding: 0.6rem 0.2rem 0;
      font-size: 0.68rem; line-height: 1.5; color: var(--muted);
      text-align: center;
    }
    .mfd.compact { font-size: 0.62rem; }
    .mfd-line { display: block; b { color: var(--ink); font-weight: 800; } }
    .mfd-amfi { display: block; margin-top: 0.35rem; font-weight: 700; color: var(--ink); opacity: 0.85; }
  `],
})
export class MfDisclaimerComponent {
  /** Smaller text when embedded under a card. */
  @Input() compact = false;
}
