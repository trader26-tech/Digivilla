import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { sessionExpiredInterceptor } from './auth/session-expired.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([sessionExpiredInterceptor])),
    // No screen uses Angular animations today; the async provider keeps the
    // ~60 kB engine out of the first download and loads it only if one does.
    provideAnimationsAsync(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Register quickly so update checks start soon after load.
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};
