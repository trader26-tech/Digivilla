# Deploying to Railway

This repo deploys as **one Railway service**. The root `Dockerfile` builds the
Angular frontend and serves it from the FastAPI backend in a single image:

```
/            -> Angular SPA
/api/v1/...  -> FastAPI
/docs        -> API docs
```

No monorepo Root Directory setting is needed — Railway builds the repo root.

## Steps

1. **New → Deploy from GitHub repo → `trader26-tech/retirement`.**
   Railway reads the root `railway.toml` and builds the root `Dockerfile`.
2. **Add environment variables** (service → Variables):
   ```
   ENVIRONMENT=production
   DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_JWT_SECRET=<jwt-secret>
   ```
   You do **not** need `API_URL` (the frontend calls the same origin at `/api/v1`)
   or `BACKEND_CORS_ORIGINS` (frontend and API share an origin).
3. **Deploy.** On boot the container: writes runtime frontend config
   (`assets/env.js` from `SUPABASE_URL` / `SUPABASE_ANON_KEY`), runs
   `alembic upgrade head`, then serves everything on `$PORT`.

That's it — open the service URL and the app loads; the API is under `/api/v1`.

## Notes

- **Port**: Railway injects `$PORT`; the Dockerfile honors it. Do not set `PORT`.
- **Database**: use the Supabase **transaction pooler** string (port `6543`) for
  `DATABASE_URL`; the backend auto-disables prepared-statement caching for it.
- **Runtime config**: Supabase values are injected at container start into
  `assets/env.js`, so one built image works across environments without a rebuild.
- **Healthcheck**: `/api/v1/health` (configured in `railway.toml`).

## Scaling to two services later

If you later want the frontend and backend to scale independently, they still have
their own `frontend/Dockerfile` and `backend/Dockerfile`. Create two services and
set each service's **Root Directory** to `frontend` / `backend`. The single-image
setup above is the recommended default and needs none of that.
