import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Always-visible "refresh to latest" button. The PWA service worker aggressively
 * caches the app, so a new deploy can keep showing the old version. Tapping this
 * unregisters the service worker, clears every cache, and hard-reloads — which
 * guarantees the very latest build loads.
 *
 * It also listens for new versions and auto-applies them, and shows a subtle
 * "Update" pulse on the button when a fresh build is ready.
 */
@Component({
  selector: 'app-refresh-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      class="refresh-fab"
      [class.has-update]="updateReady"
      (click)="hardRefresh()"
      [attr.aria-label]="updateReady ? 'Update available — tap to refresh' : 'Refresh to latest version'"
      title="Refresh to the latest version"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" [class.spin]="busy">
        <path
          d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="refresh-label" *ngIf="updateReady">Update</span>
    </button>
  `,
  styles: [`
    .refresh-fab {
      position: fixed;
      right: 14px;
      bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      height: 44px;
      padding: 0 0.7rem;
      border-radius: 999px;
      border: 1px solid rgba(16, 24, 40, 0.12);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(8px);
      color: #16202e;
      cursor: pointer;
      box-shadow: 0 6px 20px -6px rgba(16, 24, 40, 0.28);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .refresh-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 26px -8px rgba(16, 24, 40, 0.35); }
    .refresh-fab:active { transform: scale(0.94); }
    .refresh-fab svg { display: block; }
    .refresh-label { font-size: 0.85rem; font-weight: 700; padding-right: 0.15rem; }

    /* When an update is ready, tint it and gently pulse to invite a tap. */
    .refresh-fab.has-update {
      background: linear-gradient(135deg, #2f6bff, #1d4fd7);
      color: #fff;
      border-color: transparent;
      animation: pulse 1.8s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 6px 20px -6px rgba(47, 107, 255, 0.5); }
      50% { box-shadow: 0 6px 26px -4px rgba(47, 107, 255, 0.85); }
    }

    .spin { animation: spin 0.8s linear infinite; transform-origin: center; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .refresh-fab.has-update { animation: none; }
      .spin { animation-duration: 1.4s; }
    }
  `],
})
export class RefreshButtonComponent implements OnInit {
  private swUpdate = inject(SwUpdate, { optional: true });

  updateReady = false;
  busy = false;

  ngOnInit(): void {
    if (!this.swUpdate?.isEnabled) return;

    // Flag when a new version has been downloaded and is ready to activate.
    this.swUpdate.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') this.updateReady = true;
    });

    // Proactively check for a new build now and every 60s while the app is open,
    // so fresh deploys are picked up without the user having to do anything.
    this.swUpdate.checkForUpdate().catch(() => {});
    setInterval(() => this.swUpdate?.checkForUpdate().catch(() => {}), 60_000);
  }

  /** Nuke every cache + the service worker, then hard-reload the newest build. */
  async hardRefresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      // 1) Let the SW activate a pending update if there is one.
      if (this.swUpdate?.isEnabled) {
        await this.swUpdate.activateUpdate().catch(() => {});
      }
      // 2) Delete every Cache Storage bucket (this is what serves stale files).
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 3) Unregister all service workers so nothing intercepts the next load.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      /* best-effort — reload regardless */
    }
    // 4) Hard reload, cache-busting the document itself.
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now().toString());
    window.location.replace(url.toString());
  }
}
