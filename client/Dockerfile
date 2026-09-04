# ---------- Stage 1: build the Angular frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /fe

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# In the combined deploy the API is same-origin, so apiUrl = ''.
RUN printf 'window.__env = { apiUrl: "" };\n' > public/assets/env.js
RUN npm run build -- --configuration production


# ---------- Stage 2: FastAPI backend serving the SPA ----------
FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy the built Angular app to where static_spa.py expects it: backend/static
COPY --from=frontend /fe/dist/frontend/browser ./static

# Railway provides $PORT at runtime.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
