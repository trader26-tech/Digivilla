// Development defaults. In the combined production container, public/assets/env.js
// sets window.__env.apiUrl = '' so the app calls the API on the same origin.
declare global {
  interface Window {
    __env?: { apiUrl?: string };
  }
}

function resolveApiUrl(): string {
  if (typeof window !== 'undefined' && window.__env && 'apiUrl' in window.__env) {
    // Present (even if '') => use it. '' means same-origin (combined deploy).
    return window.__env.apiUrl ?? '';
  }
  return 'http://localhost:8000';
}

export const environment = {
  apiUrl: resolveApiUrl(),
};
