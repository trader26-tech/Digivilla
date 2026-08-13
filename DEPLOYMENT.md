# Deploying to Railway

This is a **monorepo** with two apps (`backend/` and `frontend/`). Railway builds
one app per service, so you create **two services** in the same Railway project,
each pointing at a subdirectory.

> The earlier failure (`Railpack could not determine how to build the app`)
> happened because the service's **Root Directory** was left at the repo root,
> so Railway scanned the whole repo and found no single app to build. Setting
> Root Directory to `backend/` or `frontend/` fixes it — Railway then finds that
> folder's `railway.toml` + `Dockerfile`.

## One-time setup (dashboard)

### 1. Backend service

1. In your Railway project: **New → GitHub Repo → `trader26-tech/retirement`**.
2. Open the service → **Settings → Source**:
   - **Root Directory**: `backend`
3. **Settings → Build**: Builder should auto-detect **Dockerfile** (from `backend/railway.toml`).
4. **Variables** (Settings → Variables) — add:
   ```
   ENVIRONMENT=production
   DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_JWT_SECRET=<jwt-secret>
   BACKEND_CORS_ORIGINS=https://<your-frontend-domain>
   ```
5. **Deploy**. Once up, note the public URL, e.g. `https://retirement-backend.up.railway.app`.

### 2. Frontend service

1. In the **same** project: **New → GitHub Repo → `trader26-tech/retirement`** (add the repo again).
2. Open the service → **Settings → Source**:
   - **Root Directory**: `frontend`
3. **Settings → Build**: Builder auto-detects **Dockerfile** (from `frontend/railway.toml`).
4. **Variables** — add (use the backend's real URL from step 1):
   ```
   API_URL=https://retirement-backend.up.railway.app/api/v1
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   ```
5. **Deploy**. This gives you the frontend's public URL — put that domain into the
   backend's `BACKEND_CORS_ORIGINS` variable and redeploy the backend so CORS allows it.

## Notes

- **Port**: Railway injects `$PORT`. Both Dockerfiles honor it (backend via gunicorn,
  frontend via nginx templating) — do **not** set a `PORT` variable yourself.
- **Migrations**: The backend runs `alembic upgrade head` on boot. You must have at
  least one migration committed (see below) or it will no-op with an empty schema.
- **DB connection string**: Use the Supabase **transaction pooler** (port `6543`)
  string for `DATABASE_URL`; the backend auto-disables prepared-statement caching for it.

## CLI alternative

```bash
# from repo root, once per service, after `railway login`
railway link                       # link to your project
# Backend
railway service create backend
railway up --service backend --detach   # set Root Directory=backend in dashboard first
```

The dashboard Root Directory setting is required either way — it is a per-service
setting, not something committed to the repo.
