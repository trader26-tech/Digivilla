import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';

/** A screen the dev-nav can jump straight to. */
export type DevScreen =
  | 'intro'
  | 'picker'
  | 'amount'
  | 'timing'
  | 'plan'
  | 'plan-invest'
  | 'plan-returns'
  | 'celebrate'
  | 'home'
  | 'landing'
  | 'dashboard'
  | 'basket';

/**
 * Developer quick-nav. A small floating button that opens a panel to jump
 * straight to any screen with sample data pre-filled — so you don't have to
 * click through the whole onboarding flow every time while building.
 *
 * Purely a dev convenience; it sits beside the refresh button.
 */
@Component({
  selector: 'app-dev-nav',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- backdrop closes the panel -->
    <div class="dev-backdrop" *ngIf="open" (click)="open = false"></div>

    <div class="dev-wrap">
      <!-- the panel -->
      <div class="dev-panel" *ngIf="open">
        <div class="dev-head">
          <span>Jump to screen</span>
          <button class="dev-x" (click)="open = false" aria-label="Close">✕</button>
        </div>

        <div class="dev-group" *ngFor="let grp of groups">
          <span class="dev-glabel">{{ grp.label }}</span>
          <div class="dev-grid">
            <button
              *ngFor="let s of grp.items"
              class="dev-item"
              (click)="pick(s.id)"
            >
              <span class="dev-ic">{{ s.icon }}</span>
              <span class="dev-nm">{{ s.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- the trigger button -->
      <button
        class="dev-fab"
        [class.on]="open"
        (click)="open = !open"
        aria-label="Developer navigation"
        title="Jump to any screen"
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        </svg>
        <span class="dev-fab-lbl">Jump</span>
      </button>
    </div>
  `,
  styles: [`
    .dev-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(1px);
      animation: fade 0.15s ease;
    }
    @keyframes fade { from { opacity: 0; } }

    .dev-wrap {
      position: fixed;
      right: 14px;
      bottom: calc(66px + env(safe-area-inset-bottom));
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.6rem;
    }

    .dev-fab {
      align-self: flex-end;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      height: 44px;
      padding: 0 0.85rem;
      border-radius: 999px;
      border: 1px solid rgba(160, 92, 255, 0.5);
      background: linear-gradient(135deg, #a05cff, #7a3ea8);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 8px 22px -8px rgba(160, 92, 255, 0.7);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .dev-fab:hover { transform: translateY(-2px); }
    .dev-fab:active { transform: scale(0.94); }
    .dev-fab.on { background: linear-gradient(135deg, #7a3ea8, #5a2d80); }
    .dev-fab svg { display: block; }
    .dev-fab-lbl { font-size: 0.85rem; font-weight: 750; }

    .dev-panel {
      width: min(320px, calc(100vw - 28px));
      max-height: min(70vh, 560px);
      overflow-y: auto;
      background: #17142b;
      border: 1px solid #342d63;
      border-radius: 18px;
      padding: 0.9rem;
      box-shadow: 0 26px 60px -20px rgba(0, 0, 0, 0.8);
      animation: rise 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
    }
    .dev-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.7rem;
      font-size: 0.95rem;
      font-weight: 800;
      color: #f2eefc;
    }
    .dev-x {
      border: none;
      background: #262151;
      color: #a99fce;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .dev-x:hover { color: #fff; }

    .dev-group { margin-bottom: 0.8rem; }
    .dev-group:last-child { margin-bottom: 0; }
    .dev-glabel {
      display: block;
      font-size: 0.66rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7d74a8;
      margin: 0 0 0.4rem 0.15rem;
    }
    .dev-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.45rem;
    }
    .dev-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.65rem 0.3rem;
      border-radius: 12px;
      background: #201c3d;
      border: 1px solid #2f2857;
      color: #f2eefc;
      cursor: pointer;
      font-family: inherit;
      transition: transform 0.12s ease, border-color 0.15s, background 0.15s;
    }
    .dev-item:hover { border-color: #a05cff; background: #262151; }
    .dev-item:active { transform: scale(0.95); }
    .dev-ic { font-size: 1.15rem; line-height: 1; }
    .dev-nm { font-size: 0.68rem; font-weight: 650; text-align: center; line-height: 1.15; }
  `],
})
export class DevNavComponent {
  open = false;

  @Output() jump = new EventEmitter<DevScreen>();

  readonly groups: { label: string; items: { id: DevScreen; name: string; icon: string }[] }[] = [
    {
      label: 'Onboarding',
      items: [
        { id: 'intro', name: 'Intro', icon: '🌅' },
        { id: 'picker', name: 'Goal picker', icon: '🎯' },
        { id: 'amount', name: 'Amount', icon: '💰' },
        { id: 'timing', name: 'Timing', icon: '📅' },
      ],
    },
    {
      label: 'Plan result',
      items: [
        { id: 'plan', name: 'Plan', icon: '📊' },
        { id: 'plan-invest', name: 'How it grows', icon: '📈' },
        { id: 'plan-returns', name: 'Returns', icon: '💹' },
        { id: 'celebrate', name: 'Celebration', icon: '🎉' },
      ],
    },
    {
      label: 'App',
      items: [
        { id: 'home', name: 'Goal home', icon: '🏠' },
        { id: 'landing', name: 'Sign in', icon: '🔑' },
        { id: 'dashboard', name: 'Dashboard', icon: '🗂️' },
        { id: 'basket', name: 'Basket lab', icon: '🧪' },
      ],
    },
  ];

  pick(id: DevScreen): void {
    this.open = false;
    this.jump.emit(id);
  }
}
