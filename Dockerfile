# Single-image deployment: build the Angular frontend, then serve it from the
# FastAPI backend. One Railway service, one deploy, no Root Directory setting.
#
#   /            -> Angular SPA
#   /api/v1/...  -> FastAPI
#   /docs        -> API docs

# --- Stage 1: build the Angular app ---
FROM node:20-alpine AS frontend

WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build
# Build output: /fe/dist/retirement-frontend/browser

# --- Stage 2: Python runtime that also serves the built frontend ---
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Backend source.
COPY backend/ .

# Drop the built Angular app where app/static.py looks for it.
COPY --from=frontend /fe/dist/retirement-frontend/browser ./app/static/browser

RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000

# Inject runtime frontend config, run migrations (with retries + clear errors),
# then serve API + SPA.
CMD ["sh", "-c", "python scripts/write_env_js.py && python scripts/migrate.py && gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-2} -b 0.0.0.0:${PORT}"]
