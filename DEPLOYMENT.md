# Deploying to Railway

The repo is a **monorepo with two independently deployable apps**, each its own
Railway service with its own `Dockerfile` and `railway.toml`:

| App       | Path     | What it is                                              | Serves on |
|-----------|----------|---------------------------------------------------------|-----------|
| **client**| `client/`| Angular PWA **+** FastAPI backend in one combined image | `$PORT`   |
| **admin** | `admin/` | Standalone Angular admin SPA (nginx), calls the backend | `$PORT`   |

The **client** is a single combined service: its `Dockerfile` builds the Angular
frontend, then serves it as static files from the FastAPI backend, so the API and
UI share one origin. The **admin** is a separate static SPA that talks to the
client's backend over HTTPS.

Because both live in one repo, the key Railway setting for each service is its
**Root Directory** — that tells Railway which subfolder's `Dockerfile` to build.

## Client service (main app + API)

1. Push this repo to GitHub (already the `origin` remote).
2. In Railway: **New Project → Deploy from GitHub repo →** select this repo.
3. **Settings → Root Directory → `client`.** Railway then uses
   `client/Dockerfile` + `client/railway.toml`.
4. (Optional) Add environment variables under the service's **Variables** tab:
   - `SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_SERVICE_KEY` — the service-role key
     (without these, the planner uses the built-in fund universe in
     `app/funds.py`, and bookings fall back to a local JSON file)
   - `ADMIN_TOKEN_SECRET` — secret used to sign admin session tokens (**change from the default**)
   - `OTP_ALLOWLIST` — emails allowed to request an admin sign-in code
   - `RESEND_API_KEY` / `OTP_FROM` — to deliver admin OTP codes by email
   - `CORS_ORIGINS` — add your admin's custom domain if you use one (Railway
     `*.up.railway.app` origins are already allowed by `cors_origin_regex`)
   - `PORT` is provided by Railway automatically — **do not set it**.
5. Railway builds the image and gives you a public URL like
   `https://<client>.up.railway.app`. Open it — the planner loads and the API is
   on the same origin.

Health check: `client/railway.toml` points it at `/health`, which returns
`{"status":"ok"}`.

## Admin service (consultation desk)

The admin is a **second Railway service in the same project**, pointed at the
client's backend URL. Full steps are in [admin/README.md](admin/README.md); in short:

1. In Railway (same project): **New → GitHub Repo →** select this repo again.
2. **Settings → Root Directory → `admin`.** Railway uses `admin/Dockerfile` +
   `admin/railway.toml`.
3. Add a variable **`ADMIN_API_URL`** = the client's backend URL, e.g.
   `https://<client>.up.railway.app`. Railway passes it as a Docker build arg so
   the built SPA calls the right backend. (Leaving it empty falls back to
   same-origin, which is only correct if co-hosted — so set it.)
4. Deploy. Railway gives the admin its own URL, e.g.
   `https://<admin>.up.railway.app`.

## How auto-deploy works

Railway's GitHub integration watches the `main` branch. **Every push to `main`
triggers a rebuild of each service.** Railway only rebuilds a service when files
under its Root Directory change, so a client-only change won't rebuild admin and
vice-versa. No extra CI config is needed.

## Local combined test (optional)

To run exactly what Railway runs for the client:

```bash
cd client
docker build -t goal-planner .
docker run -p 8000:8000 -e PORT=8000 goal-planner
# open http://localhost:8000
```

And the admin (pointed at that backend):

```bash
cd admin
docker build --build-arg ADMIN_API_URL=http://localhost:8000 -t goal-planner-admin .
docker run -p 8080:8080 -e PORT=8080 goal-planner-admin
# open http://localhost:8080
```
