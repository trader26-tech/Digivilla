// Runtime configuration. Overwritten at container startup on deploy.
// In local dev this file is a no-op and environment.ts falls back to :8000.
window.__env = window.__env || {};

// Firebase web config (project: mylakshayas) — used by the phone-OTP login.
window.__env.firebase = {
  apiKey: "AIzaSyBtUWNbC4OB8sjJ3VXYyRb8AMzCPayzE48",
  authDomain: "mylakshayas.firebaseapp.com",
  projectId: "mylakshayas",
  storageBucket: "mylakshayas.firebasestorage.app",
  messagingSenderId: "572488679925",
  appId: "1:572488679925:web:945d9047aa80946b0a60bc",
  measurementId: "G-41V00XP3GC",
};
