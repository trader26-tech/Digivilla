import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// iOS ignores user-scalable=no in some modes — block pinch-zoom there too.
for (const ev of ['gesturestart', 'gesturechange']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

// The home is its own chunk (so a first visit's login downloads less). A signed-in
// open goes straight to it, so start fetching it now, alongside the bootstrap.
try { if (localStorage.getItem('auth_token_v1')) import('./app/estate-home.component'); } catch {}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
