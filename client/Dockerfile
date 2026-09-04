# Combined client image: build the Angular PWA, then serve it from FastAPI.
# NOTE: COPY paths are relative to the REPO ROOT (Railway's build context when
# RAILWAY_DOCKERFILE_PATH=client/Dockerfile), so they are prefixed with client/.

# ---------- Stage 1: build the Angular frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /fe

COPY client/frontend/package.json client/frontend/package-lock.json ./
RUN npm ci

COPY client/frontend/ ./
# env.js is (re)generated at container startup from runtime env vars (see the
# runtime stage below), so no need to bake real values in here. A minimal
# same-origin default keeps a plain `npm run build` self-contained.
RUN printf 'window.__env = { apiUrl: "" };\n' > public/assets/env.js
RUN npm run build -- --configuration production


# ---------- Stage 2: FastAPI backend serving the SPA ----------
FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY client/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY client/backend/ ./

# Copy the built Angular app to where static_spa.py expects it: backend/static
COPY --from=frontend /fe/dist/frontend/browser ./static

# Generate the runtime frontend config (window.__env) from environment vars at
# container startup. This lets you set Firebase web config + apiUrl + bookingApiUrl
# entirely from the deploy platform's dashboard (Railway variables) with no rebuild.
COPY client/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Railway provides $PORT at runtime.
ENV PORT=8000
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
