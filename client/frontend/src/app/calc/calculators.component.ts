import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

import { FlatCalcComponent } from './flat-calc.component';
import { LandCalcComponent } from './land-calc.component';

type CalcKey = 'land' | 'flat';

interface CalcCard {
  key: CalcKey;
  title: string;
  blurb: string;
  /** accent for the card's icon tile */
  tint: string;
}

/**
 * Calculators — the 4th bottom-nav tab. A list of calculator cards; tapping one
 * opens that calculator in place (its back arrow returns here).
 *
 * TO ADD A CALCULATOR: add its key to `CalcKey`, a card to `CALCS`, its component
 * to `imports`, and one `@if (open() === 'key')` branch in the template.
 */
@Component({
  selector: 'app-calculators',
  standalone: true,
  imports: [CommonModule, LandCalcComponent, FlatCalcComponent],
  template: `
    @if (open() === 'land') {
      <app-land-calc (back)="close()"></app-land-calc>
    } @else if (open() === 'flat') {
      <app-flat-calc (back)="close()"></app-flat-calc>
    } @else {
      <div class="ch">
        <header>
          <div class="ch-kicker">Tools</div>
          <h1>Calculators</h1>
          <p>See how your property has really done, and what the same money would have become in your basket.</p>
        </header>

        <button *ngFor="let c of CALCS" class="ch-card" (click)="openCalc(c.key)">
          <span class="ch-ic" [style.background]="c.tint + '1f'" [style.color]="c.tint" aria-hidden="true">
            <ng-container [ngSwitch]="c.key">
              <svg *ngSwitchCase="'land'" viewBox="0 0 32 32" width="26" height="26">
                <path d="M16 7 29 14.5 16 22 3 14.5Z" fill="currentColor" opacity=".28"/>
                <path d="M16 7 29 14.5 16 22 3 14.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M3 14.5v3L16 25l13-7.5v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M9 17l5-3 3 2 6-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <svg *ngSwitchCase="'flat'" viewBox="0 0 32 32" width="26" height="26">
                <rect x="9" y="5" width="14" height="23" rx="1.5" fill="currentColor" opacity=".28"/>
                <rect x="9" y="5" width="14" height="23" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M13 10h2M17 10h2M13 14.5h2M17 14.5h2M13 19h2M17 19h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M14.5 28v-4h3v4M4 28h24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </ng-container>
          </span>
          <span class="ch-txt">
            <b>{{ c.title }}</b>
            <span>{{ c.blurb }}</span>
          </span>
          <svg class="ch-go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; background: var(--paper); }
    .ch { max-width: 460px; margin: 0 auto; padding: calc(22px + env(safe-area-inset-top)) 16px calc(120px + env(safe-area-inset-bottom));
      display: flex; flex-direction: column; gap: 12px; color: var(--ink); font-family: var(--font-body); }
    header { margin-bottom: 6px; }
    .ch-kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
    h1 { margin: 2px 0 6px; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
    header p { margin: 0; font-size: 14px; line-height: 1.45; color: var(--muted); }
    .ch-card { display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px; text-align: left; cursor: pointer;
      border: 1px solid var(--survey); border-radius: 16px; background: var(--card); color: var(--ink); font-family: var(--font-body);
      transition: border-color .15s, transform .1s; }
    .ch-card:hover { border-color: var(--brass); }
    .ch-card:active { transform: scale(.99); }
    .ch-ic { flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; }
    .ch-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .ch-txt b { font-size: 16px; font-weight: 600; }
    .ch-txt span { font-size: 13px; line-height: 1.4; color: var(--muted); }
    .ch-go { flex: none; color: var(--muted); }
  `],
})
export class CalculatorsComponent {
  readonly CALCS: CalcCard[] = [
    { key: 'land', title: 'Land', blurb: "Your land's yearly growth (CAGR), and what the same money would be worth in your basket.", tint: '#E9C15C' },
    { key: 'flat', title: 'Flat', blurb: "Your flat's real return with rent, tax and costs, against DigiVilla paying you the same rent.", tint: '#8B7BF0' },
  ];

  readonly open = signal<CalcKey | null>(null);
  openCalc(k: CalcKey): void {
    this.open.set(k);
    window.scrollTo({ top: 0 });
    if (navigator.vibrate) navigator.vibrate(4);
  }
  close(): void { this.open.set(null); window.scrollTo({ top: 0 }); }
}
