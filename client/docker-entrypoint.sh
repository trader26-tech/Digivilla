#!/bin/sh
# Generate the runtime frontend config (window.__env) from environment vars at
# container startup, so the API URLs and Firebase web config can be set entirely
# from the deploy platform's dashboard (Railway variables) with NO rebuild.
#
#   API_URL          — planner/funds API base. Empty '' = same-origin (default,
#                      correct for this combined container).
#   BOOKING_API_URL  — the admin backend's URL (serves /bookings + /bookings/taken),
#                      e.g. https://<admin-api>.up.railway.app
#   FIREBASE_API_KEY, FIREBASE_APP_ID, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
#   FIREBASE_MESSAGING_SENDER_ID — Firebase web config (enables real phone-OTP SMS).
set -e

ENV_JS=./static/assets/env.js
mkdir -p ./static/assets

cat > "$ENV_JS" <<EOF
// Generated at container startup by docker-entrypoint.sh from env vars.
window.__env = {
  apiUrl: "${API_URL:-}",
  bookingApiUrl: "${BOOKING_API_URL:-}",
  firebase: {
    apiKey: "${FIREBASE_API_KEY:-}",
    authDomain: "${FIREBASE_AUTH_DOMAIN:-mylakshayas.firebaseapp.com}",
    projectId: "${FIREBASE_PROJECT_ID:-mylakshayas}",
    appId: "${FIREBASE_APP_ID:-}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID:-}"
  }
};
EOF

# Hand off to the CMD (uvicorn).
exec "$@"
