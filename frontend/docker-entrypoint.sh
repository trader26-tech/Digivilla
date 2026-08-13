#!/bin/sh
# Runs before nginx starts (placed in /docker-entrypoint.d/).
# Writes runtime configuration into the served static files so a single built
# image can be promoted across environments. Set these in the Railway service:
#   API_URL, SUPABASE_URL, SUPABASE_ANON_KEY
set -e

ENV_FILE=/usr/share/nginx/html/assets/env.js
mkdir -p "$(dirname "$ENV_FILE")"

cat > "$ENV_FILE" <<EOF
window.__env = {
  apiUrl: "${API_URL:-/api/v1}",
  supabaseUrl: "${SUPABASE_URL:-}",
  supabaseAnonKey: "${SUPABASE_ANON_KEY:-}"
};
EOF

echo "Wrote runtime config to $ENV_FILE"
