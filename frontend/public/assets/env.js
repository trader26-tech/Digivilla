// Runtime config, read by the app at startup via window.__env.
// This file is served as a static asset (not bundled), so it can be edited
// per-environment without rebuilding.
window.__env = {
  // Same-origin API by default ('' → the app calls /... on its own host).
  // Set to e.g. 'http://localhost:8000' for a local split backend.
  apiUrl: '',

  // ── Firebase web config — enables REAL phone-OTP SMS. ────────────────────
  // Fill these from the Firebase Console:
  //   Project Settings → General → Your apps → Web app → SDK setup & config.
  // Until apiKey + appId are set, the app runs OTP in dev mode (code 123456).
  // project_id is known ("mylakshayas"), so authDomain is pre-filled.
  firebase: {
    apiKey: '',                               // ← REQUIRED for real SMS
    authDomain: 'mylakshayas.firebaseapp.com',
    projectId: 'mylakshayas',
    appId: '',                                // ← REQUIRED for real SMS
    messagingSenderId: '',                    // optional
  },
};
