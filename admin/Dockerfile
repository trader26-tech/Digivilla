# ---------- Stage 1: build the admin Angular app ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
# Point the admin app at the backend. Set ADMIN_API_URL as a build arg in
# Railway to the deployed backend URL, e.g. https://<backend>.up.railway.app.
# Empty -> the app falls back to same-origin (only correct if co-hosted).
ARG ADMIN_API_URL=""
RUN printf 'window.__env = { apiUrl: "%s" };\n' "$ADMIN_API_URL" > public/assets/env.js
RUN npm run build -- --configuration production


# ---------- Stage 2: serve the static SPA ----------
FROM nginx:alpine AS runtime
# SPA fallback: any unknown path returns index.html.
RUN printf 'server {\n\
  listen $PORT;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist/admin/browser /usr/share/nginx/html

# Railway provides $PORT; nginx's entrypoint runs envsubst on the template at
# start. Restrict it to ONLY $PORT so nginx's own $uri / $host in try_files are
# left untouched (otherwise envsubst would blank them and break SPA routing).
ENV PORT=8080 \
    NGINX_ENVSUBST_FILTER=PORT
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
