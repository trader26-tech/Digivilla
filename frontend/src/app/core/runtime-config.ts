import { environment } from '../../environments/environment';

/**
 * Runtime configuration.
 *
 * In production the container's entrypoint writes /assets/env.js which sets
 * `window.__env` from Railway environment variables. This lets a single built
 * image be promoted across environments without a rebuild. When that global is
 * absent (e.g. local `ng serve`), we fall back to the compiled `environment`.
 */
type RuntimeEnv = {
  apiUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

declare global {
  interface Window {
    __env?: RuntimeEnv;
  }
}

const win = typeof window !== 'undefined' ? window.__env ?? {} : {};

export const config = {
  apiUrl: win.apiUrl || environment.apiUrl,
  supabaseUrl: win.supabaseUrl || environment.supabaseUrl,
  supabaseAnonKey: win.supabaseAnonKey || environment.supabaseAnonKey,
};
