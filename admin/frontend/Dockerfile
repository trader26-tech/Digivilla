# ---------- Stage 1: build the admin Angular app ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
# env.js is (re)generated at container startup from ADMIN_API_URL (see the
# entrypoint below), so no need to bake the backend URL in here. A minimal
# same-origin default keeps a plain `npm run build` self-contained.
RUN printf 'window.__env = { apiUrl: "" };\n' > public/assets/env.js
RUN npm run build -- --configuration production


# ---------- Stage 2: serve the static SPA (nginx) ----------
FROM nginx:alpine AS runtime
# SPA fallback: any unknown path returns index.html. $PORT is substituted at
# startup by the entrypoint (envsubst is restricted to $PORT so nginx's own
# $uri / $host in try_files survive).
RUN printf 'server {\n\
  listen $PORT;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location /assets/env.js { add_header Cache-Control "no-store"; }\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist/admin/browser /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-admin-env.sh
RUN chmod +x /docker-entrypoint.d/40-admin-env.sh

# Railway provides $PORT at runtime.
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.d/40-admin-env.sh"]
