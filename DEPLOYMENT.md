# Deploying to Railway

This app deploys as a **single combined service**: the `Dockerfile` builds the
Angular frontend, then serves it as static files from the FastAPI backend. The
API and UI share one origin and one URL — no CORS or second service needed.

## One-time setup

1. Push this repo to GitHub (already the `origin` remote).
2. In Railway: **New Project → Deploy from GitHub repo →** select this repo.
3. Railway detects the root `Dockerfile` and `railway.toml` automatically.
4. (Optional) Add environment variables under the service's **Variables** tab:
   - `SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_SERVICE_KEY` — the service-role key
   - Without these, the planner uses the built-in fund universe (`app/funds.py`).
   - `PORT` is provided by Railway automatically — do not set it.
5. Railway builds the image and gives you a public URL like
   `https://<name>.up.railway.app`. Open it — the planner loads and the API is
   on the same origin.

## How auto-deploy works

Railway's GitHub integration watches the `main` branch. **Every push to `main`
triggers a new build + deploy.** No extra CI config is needed.

## Health check

`railway.toml` points the health check at `/health`, which returns
`{"status":"ok"}`.

## Local combined test (optional)

To run exactly what Railway runs:

```bash
docker build -t goal-planner .
docker run -p 8000:8000 -e PORT=8000 goal-planner
# open http://localhost:8000
```
