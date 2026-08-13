# --- Build stage ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine

# SPA nginx config (templated so it can read $PORT at runtime).
# Restrict envsubst to ${PORT} only, so nginx variables like $uri survive.
ENV NGINX_ENVSUBST_FILTER="PORT"
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Built static assets.
COPY --from=build /app/dist/retirement-frontend/browser /usr/share/nginx/html

# Entrypoint injects runtime env into assets/env.js and starts nginx.
COPY docker-entrypoint.sh /docker-entrypoint.d/40-env.sh
RUN chmod +x /docker-entrypoint.d/40-env.sh

# Railway provides $PORT; the official nginx image's entrypoint runs the
# templating + our env script, then launches nginx.
ENV PORT=8080
EXPOSE 8080
