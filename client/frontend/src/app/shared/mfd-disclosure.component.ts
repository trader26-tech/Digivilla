import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The MFD (mutual-fund distributor) statutory disclosure block: ARN, commission
 * nature, execution-only nature, and the mandatory market-risk line — plus a
 * placeholder for SEBI-format past performance sourced from the AMC factsheet.
 *
 * PLACEHOLDERS to fill before going live:
 *   • ARN — put your real ARN number in `arn`.
 *   • Past performance — replace with the scheme's actual SEBI-format returns.
 *
 * IMPORTANT: this block surfaces required text only. It does NOT make the
 * product compliant on its own — real KYC/RTA rails, staying execution-only,
 * matching the metaphor to the fund's real risk, and a SEBI/AMFI compliance
 * sign-off are all still required and are outside the frontend.
 */
@Component({
  selector: 'app-mfd-disclosure',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mfd2">
      <p class="mfd2-line">
        Distributed by <b>{{ entity }}</b> · AMFI Reg. No.
        <b>{{ arn || 'ARN-XXXXXX (to be added)' }}</b> · Mutual Fund Distributor.
        Execution-only — we do not provide investment advice or recommend
        schemes for your profile. We earn commission / trail from the AMC; this
        does not add to your cost but is not a neutral incentive.
      </p>
      <p class="mfd2-line">
        Assets shown are a <b>visualisation of mutual-fund units</b> held in your
        name at NAV, not real property. Any monthly “payout” is a
        <b>Systematic Withdrawal Plan (SWP)</b> — you redeem your own units,
        which draws down and can deplete your capital. Past performance (see the
        scheme factsheet) may not be sustained; <b>no returns are assured.</b>
      </p>
      <p class="mfd2-amfi">
        Mutual fund investments are subject to market risks. Read all scheme
        related documents carefully.
      </p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mfd2 { padding: 0.8rem 0.2rem 0; text-align: left; }
    .mfd2-line { margin: 0 0 0.5rem; font-size: 0.66rem; line-height: 1.5; color: var(--muted); b { color: var(--ink); font-weight: 700; } }
    .mfd2-amfi { margin: 0; font-size: 0.66rem; line-height: 1.45; font-weight: 700; color: var(--ink); opacity: 0.85; text-align: center; }
  `],
})
export class MfdDisclosureComponent {
  /** Your registered entity name — fill before launch. */
  @Input() entity = 'Your Entity Pvt. Ltd. (to be added)';
  /** Your AMFI ARN — fill once issued. */
  @Input() arn = '';
}
