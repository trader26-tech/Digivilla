import { Injectable } from '@angular/core';

/**
 * Force the PWA to the latest deployed version.
 *
 * The service worker (ngsw) caches the app shell aggressively, so a plain
 * reload can keep serving a stale build. `forceUpdate()` unregisters every
 * service worker, deletes all Cache Storage entries, then hard-reloads — which
 * guarantees the newest files are fetched from the network. The login token
 * lives in localStorage (untouched here), so the user stays signed in.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  async forceUpdate(): Promise<void> {
    try {
      // 1. ask any active SW to check for + activate a new version (best effort)
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(async (r) => {
          try { await r.update(); } catch {}
          try { await r.unregister(); } catch {}
        }));
      }
      // 2. drop every cached response so the reload pulls fresh files
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* even if the above fails, still hard-reload below */
    }
    // 3. hard reload, cache-busted, to the newest deployed app
    const url = new URL(location.href);
    url.searchParams.set('_v', Date.now().toString());
    location.replace(url.toString());
  }
}
