# Retirement

Monorepo with two independently deployable apps:

```
retirement/
├── backend/    # FastAPI (async SQLAlchemy + Alembic), talks to Supabase Postgres
├── frontend/   # Angular (standalone + Material), uses Supabase JS for auth
└── docker-compose.yml   # local full-stack orchestration
```

Everything else lives inside `backend/` or `frontend/` — the root stays clean.

## Architecture

- **Auth**: Supabase Auth issues JWTs. The frontend signs in via `@supabase/supabase-js`
  and attaches the access token to API calls (see `auth.interceptor.ts`). The backend
  verifies the token against `SUPABASE_JWT_SECRET` (see `app/core/security.py`).
- **Data**: The backend owns the schema via SQLAlchemy models + Alembic migrations,
  connecting to Supabase Postgres over the async `asyncpg` driver. The `users` table is
  a 1:1 profile extension of Supabase's `auth.users`.
- **Config**: Both apps read config from environment variables. The frontend uses a
  runtime `assets/env.js` (generated at container start) so one built image works across
  environments without a rebuild.

## Local development

Prereqs: Docker, plus a Supabase project (free tier is fine).

1. `cp backend/.env.example backend/.env` and fill in your Supabase `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET`.
2. Export `SUPABASE_URL` and `SUPABASE_ANON_KEY` in your shell (used by the frontend).
3. `docker compose up --build`
   - API → http://localhost:8000 (docs at `/docs`)
   - App → http://localhost:8080

### Running apps directly (without Docker)

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic revision --autogenerate -m "initial"   # first time
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend:
```bash
cd frontend
npm install
npm start   # http://localhost:4200
```

## Deploying to Railway

Deploy the two apps as **two separate Railway services** from this one repo:

1. **Backend service** — set root directory to `backend/`. Railway picks up
   `backend/railway.toml` + `Dockerfile`. Set variables: `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_JWT_SECRET`, `BACKEND_CORS_ORIGINS` (the frontend's public URL),
   `ENVIRONMENT=production`. Migrations run automatically on boot.
2. **Frontend service** — set root directory to `frontend/`. Set variables:
   `API_URL` (the backend service's public URL + `/api/v1`), `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`.

Railway injects `$PORT` into both services; the Dockerfiles honor it.

> Use the Supabase **transaction pooler** connection string (port 6543) for
> `DATABASE_URL` in production — the backend auto-disables prepared-statement
> caching for pooled connections.
