import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** A saved session the backend no longer accepts (expired, or signed with
 *  another secret) must send the user back to sign-in — otherwise every
 *  /me/... call fails quietly and the home paints stale cached tiles as if
 *  they were real numbers. Only a 401 for the token we still hold counts, so a
 *  late reply to an old session can't sign out a fresh login. */
export const sessionExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const sent = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  return next(req).pipe(
    catchError((e: unknown) => {
      if (e instanceof HttpErrorResponse && e.status === 401 && sent && sent === auth.token()) {
        auth.signOut();
      }
      return throwError(() => e);
    }),
  );
};
