declare global {
  interface Window {
    __env?: { apiUrl?: string };
  }
}

function resolveApiUrl(): string {
  if (typeof window !== 'undefined' && window.__env && 'apiUrl' in window.__env) {
    return window.__env.apiUrl ?? '';
  }
  // Local dev default: the main backend on :8000.
  return 'http://localhost:8000';
}

export const environment = {
  apiUrl: resolveApiUrl(),
};
