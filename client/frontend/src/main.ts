import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// iOS ignores user-scalable=no in some modes — block pinch-zoom there too.
for (const ev of ['gesturestart', 'gesturechange']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
