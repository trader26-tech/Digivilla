# Deploying to Railway

The repo is a **monorepo of two apps, each split into a frontend and a backend**:

```
client/
  frontend/   Angular PWA (goal planner, funds, storefront)
  backend/    FastAPI — planner math, funds, goals, baskets, user auth
admin/
  frontend/   Angular admin SPA (consultation desk)
  backend/    FastAPI — admin auth, bookings, availability, documents
```

The two backends **share one Supabase database**, so a booking confirmed in the
admin is immediately visible in the client app. That's the whole point of the
split: each app deploys and scales independently, but they stay in sync through
the shared DB.

On Railway each folder is its **own service**, and the one setting that makes it
work is each service's **Root Directory**. You'll create **up to four services**:

| # | Service            | Root Directory     | Type            | Serves on |
|---|--------------------|--------------------|-----------------|-----------|
| 1 | Client (app + API) | `client`           | Docker (FastAPI + SPA) | `$PORT` |
| 2 | Admin API          | `admin/backend`    | Docker (FastAPI)       | `$PORT` |
| 3 | Admin frontend     | `admin/frontend`   | Docker (nginx SPA)     | `$PORT` |

> The **client** service is combined (its FastAPI backend serves its own SPA), so
> it's a single service. The **admin** is split into an API service and a static
> SPA service.

---

## How the pieces talk

```
                         ┌──────────────────────┐
  Client SPA  ───────────┤  CLIENT service       │  (same origin)
  (planner/funds/auth)   │  FastAPI + Angular    │
                         └──────────────────────┘
  Client SPA  ─ /bookings ─┐
  (booking sheet)          │        ┌──────────────────┐     ┌────────────┐
                           ├───────▶│  ADMIN API        │────▶│  Supabase  │
  Admin SPA  ─ /admin/* ───┘        │  FastAPI          │     │  (shared)  │
  (dashboard)                       └──────────────────┘     └────────────┘
                                              ▲
                                              │  /admin/*
                         Admin frontend ──────┘
```

- Client SPA → **client backend** for the planner/funds/auth (same origin).
- Client SPA → **admin API** for `/bookings` and `/bookings/taken` (so taken slots
  reflect what the admin has confirmed/blocked). This is the `bookingApiUrl` var.
- Admin SPA → **admin API** for everything (`ADMIN_API_URL`).

---

## Service 1 — Client (app + API)

1. **New Project → Deploy from GitHub repo →** select this repo.
2. **Settings → Root Directory → `client`.**
3. **Variables** (all optional; app runs without them):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — else built-in fund universe
   - `BOOKING_API_URL` — the **Admin API** URL (service 2), e.g.
     `https://<admin-api>.up.railway.app`, so the booking sheet talks to it
   - `FIREBASE_API_KEY`, `FIREBASE_APP_ID` (+ optional
     `FIREBASE_MESSAGING_SENDER_ID`) — enable real phone-OTP SMS
   - `API_URL` — leave unset/empty (same-origin combined container)
   - ⚠️ Do **not** set `PORT` — Railway injects it.

   These are read at container startup by `client/docker-entrypoint.sh`, which
   regenerates `assets/env.js` — so you can change them with no rebuild.

Health check: `/health`.

## Service 2 — Admin API

1. **New → GitHub Repo →** same repo.
2. **Settings → Root Directory → `admin/backend`.**
3. **Variables** — this is where the admin secrets live (the code that reads them
   runs here):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — **the SAME values as service 1** so
     the two apps share bookings/availability/documents
   - `ADMIN_TOKEN_SECRET` — **change from the default** (signs admin sessions)
   - `OTP_ALLOWLIST` — emails allowed to request a sign-in code
   - `RESEND_API_KEY` + `OTP_FROM` — deliver the OTP by email (without them the
     code prints to this service's logs — fine for testing)
   - `CORS_ORIGINS` — include the admin frontend URL **and** the client URL if you
     use custom domains (Railway `*.up.railway.app` is already allowed)
   - ⚠️ Do **not** set `PORT`.

Health check: `/health`.

## Service 3 — Admin frontend

1. **New → GitHub Repo →** same repo.
2. **Settings → Root Directory → `admin/frontend`.**
3. **Variables:**
   - `ADMIN_API_URL` = the **Admin API** URL (service 2), e.g.
     `https://<admin-api>.up.railway.app`

   Read at startup by the nginx entrypoint, which writes `assets/env.js` — no
   rebuild needed to change it.

---

## Deploy order

1. **Admin API** first → copy its URL.
2. **Admin frontend** with `ADMIN_API_URL` = that URL.
3. **Client** with `BOOKING_API_URL` = the Admin API URL.

(If you deploy out of order, just set the variable afterward and redeploy — the
config is read at startup, so a restart is enough; no rebuild.)

## Auto-deploy

Railway watches `main` and rebuilds **only** the services whose Root Directory
files changed. A client-only change won't rebuild the admin, and vice-versa.

## Local test (all four processes)

```bash
# Client backend  :8000
cd client/backend && python3 -m venv .venv && . .venv/bin/activate \
  && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000

# Admin backend   :8001   (client SPA's bookingApiUrl points here in dev)
cd admin/backend && python3 -m venv .venv && . .venv/bin/activate \
  && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8001

# Client frontend :4200
cd client/frontend && npm install && npm start

# Admin frontend  :4300
cd admin/frontend && npm install && npm start
```
