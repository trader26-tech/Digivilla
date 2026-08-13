export const environment = {
  production: true,
  // Injected at container start into env.js (see Dockerfile + entrypoint).
  // Falls back to build-time values below when window config is absent.
  apiUrl: '/api/v1',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
