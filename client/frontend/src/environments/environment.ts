// Development defaults. In the combined production container, public/assets/env.js
// sets window.__env.apiUrl = '' so the app calls the planner/funds API on the
// same origin. Bookings live on the SEPARATE admin backend, so bookingApiUrl
// points there (window.__env.bookingApiUrl); in dev both default to :8000/:8001.
declare global {
  interface Window {
    __env?: { apiUrl?: string; bookingApiUrl?: string };
  }
}

function resolveApiUrl(): string {
  if (typeof window !== 'undefined' && window.__env && 'apiUrl' in window.__env) {
    // Present (even if '') => use it. '' means same-origin (combined deploy).
    return window.__env.apiUrl ?? '';
  }
  return 'http://localhost:8000';
}

function resolveBookingApiUrl(): string {
  // The booking endpoints (/bookings, /bookings/taken) are served by the admin
  // backend, which shares the bookings DB with the admin dashboard.
  if (typeof window !== 'undefined' && window.__env && 'bookingApiUrl' in window.__env) {
    return window.__env.bookingApiUrl ?? '';
  }
  // Local dev: the admin backend runs on :8001 (client backend is on :8000).
  return 'http://localhost:8001';
}

export const environment = {
  apiUrl: resolveApiUrl(),
  bookingApiUrl: resolveBookingApiUrl(),
};
