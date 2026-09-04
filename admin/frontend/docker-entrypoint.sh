#!/bin/sh
# Generate the runtime frontend config (window.__env) from environment vars at
# container startup, so the admin's backend URL can be set from the deploy
# platform's dashboard (Railway variables) with NO rebuild.
#
#   ADMIN_API_URL — the admin backend's URL, e.g. https://<admin-api>.up.railway.app
#                   (empty falls back to same-origin, only correct if co-hosted)
set -e

WEBROOT=/usr/share/nginx/html
mkdir -p "$WEBROOT/assets"
cat > "$WEBROOT/assets/env.js" <<EOF
window.__env = { apiUrl: "${ADMIN_API_URL:-}" };
EOF

# Render nginx config with the runtime $PORT, then hand off to nginx.
envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
