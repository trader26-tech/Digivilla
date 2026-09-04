# MyLakshyas — Admin (Consultation desk)

A small standalone Angular app for the admin to see plot-reservation
consultation requests on a calendar and confirm/decline each slot. It talks to
the **same backend** as the main app (the `/admin/*` and `/bookings` endpoints).

## Run locally

```bash
cd admin
npm install
npm start          # serves on http://localhost:4300
```

It points at the backend on `http://localhost:8000` by default. Start the
backend too (`cd backend && uvicorn app.main:app --reload --port 8000`).

Default login (dev): **admin / admin123**.

## Deploy to Railway (separate service)

The admin is its own Railway service — a static SPA served by nginx.

1. In Railway: **New Project → Deploy from GitHub repo →** select this repo.
2. **Set the service Root Directory to `admin`** (Settings → Root Directory).
   Railway then uses `admin/Dockerfile` + `admin/railway.toml`.
3. Add a **build arg** so the admin points at your deployed backend:
   - Variable name: `ADMIN_API_URL`
   - Value: your backend URL, e.g. `https://<backend>.up.railway.app`
   (Railway passes service variables as Docker build args.)
4. Deploy. Railway gives the admin its own URL, e.g.
   `https://<admin>.up.railway.app`.

### Backend env vars (set on the BACKEND service)

- `ADMIN_USER` — admin login username (default `admin`)
- `ADMIN_PASSWORD` — admin login password (default `admin123` — **change this**)
- `ADMIN_TOKEN_SECRET` — secret used to sign admin session tokens

### Backend CORS

The admin runs on a different origin, so the backend must allow it. The backend
already allows any `https://*.up.railway.app` origin via `cors_origin_regex`, so
a Railway-hosted admin works out of the box. For a custom domain, add it to
`CORS_ORIGINS` on the backend service.

### First-time table setup

The bookings live in the `bookings` table. Create it once in Supabase:
run `python backend/create_bookings_table.py` (it prints the SQL) and paste
that into the Supabase SQL editor. Without Supabase, the backend stores bookings
in a local JSON file automatically.
