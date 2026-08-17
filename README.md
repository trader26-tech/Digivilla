# Retirement

Monorepo with two independently deployable apps:

```
retirement/
├── backend/    # FastAPI (async SQLAlchemy + Alembic), talks to Supabase Postgres
├── frontend/   # Angular (standalone + Material), uses Supabase JS for auth
└── docker-compose.yml   # local full-stack orchestration
```

Everything else lives inside `backend/` or `frontend/` — the root stays clean.

## Mutual Fund data platform

The app ships a mutual-fund explorer for **every Indian scheme**:

- **Sources** (free, legitimate): [AMFI](https://www.amfiindia.com) NAVAll feed for
  the full scheme catalog + daily NAV, and [mfapi.in](https://www.mfapi.in) for
  per-scheme NAV history. No paywalled scraping.
- **Computed analytics**: trailing returns (1M/3M/6M/1Y), 3Y/5Y CAGR, CAGR since
  inception, annualized volatility, and max drawdown — all derived from NAV history.
- **Ingestion**: on first boot the catalog seeds from AMFI (~14k schemes); a
  scheduler refreshes daily. Per-scheme history is backfilled on demand and cached
  in Postgres. See `app/services/mf_ingest.py`, `mf_analytics.py`, `mf_scheduler.py`.
- **API**: `GET /api/v1/funds` (search/filter/sort/paginate), `/funds/{code}`
  (detail + metrics), `/funds/{code}/nav` (history), `/funds/facets`, `/funds/stats`,
  `POST /funds/refresh`.
- **UI**: dashboard overview, searchable explorer, and a scheme detail page with an
  inline-SVG NAV chart (no chart library — small bundle, CSP-safe).

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

Deploy as **one service** — the root `Dockerfile` builds the Angular app and
serves it from FastAPI (SPA at `/`, API at `/api/v1`). Deploy the repo from
GitHub, add the Supabase variables, done. Full steps in [DEPLOYMENT.md](DEPLOYMENT.md).

> Use the Supabase **transaction pooler** connection string (port 6543) for
> `DATABASE_URL` in production — the backend auto-disables prepared-statement
> caching for pooled connections.

Each app also keeps its own `Dockerfile` if you later want to split them into two
independently scaled services (see DEPLOYMENT.md).
