import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { config } from '../runtime-config';
import { AuthService } from '../services/auth.service';

/**
 * Attaches the Supabase access token to requests bound for our own API.
 * External URLs (e.g. Supabase's own endpoints) are left untouched.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken;

  const isApiRequest = req.url.startsWith(config.apiUrl) || req.url.startsWith('/api');
  if (token && isApiRequest) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(req);
};
