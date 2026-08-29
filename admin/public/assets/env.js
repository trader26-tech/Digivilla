// Local-dev no-op: leaves window.__env unset so the app falls back to
// http://localhost:8000. At deploy time this file is overwritten with the
// real backend URL, e.g. window.__env = { apiUrl: "https://<backend>.up.railway.app" };
window.__env = window.__env || {};
