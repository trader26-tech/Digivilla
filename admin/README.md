# MyLakshyas — Admin (Consultation desk)

The admin app, split into two independently deployable pieces (mirrors `client/`):

- **`frontend/`** — the Angular admin SPA (calendar of bookings, availability
  editor, per-client documents). Served by nginx.
- **`backend/`** — the FastAPI admin API (`/admin/*` + the public `/bookings`
  endpoints). Shares the **same Supabase database** as the client backend, so a
  booking confirmed here is instantly reflected in the client app.

## Run locally

```bash
# Backend on :8001  (the client SPA's booking calls point here in dev)
cd admin/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional: add the shared Supabase keys
uvicorn app.main:app --reload --port 8001

# Frontend on :4300  (points at http://localhost:8001 by default)
cd admin/frontend
npm install
npm start
```

Sign-in is email-OTP → PIN → trusted device. Without `RESEND_API_KEY`, the code
is printed to the **admin backend's** server log so you can test the flow.

## Deploy to Railway

Two services, each with its Root Directory set:

| Service        | Root Directory   | Key variable |
|----------------|------------------|--------------|
| Admin API      | `admin/backend`  | `SUPABASE_*` (same as client), `ADMIN_TOKEN_SECRET`, `OTP_ALLOWLIST`, `RESEND_API_KEY` |
| Admin frontend | `admin/frontend` | `ADMIN_API_URL` = the Admin API's URL |

Full walkthrough (including how the client's booking sheet is wired to this API)
is in the repo's [DEPLOYMENT.md](../DEPLOYMENT.md).

## First-time Supabase tables

The admin uses tables `bookings`, `admin_config`, `admin_blocked_slots`,
`admin_documents`, `admin_otp`, `admin_devices`, and a storage bucket
`client-docs`. Without Supabase configured, everything falls back to local JSON
under `backend/app/data/` automatically (fine for dev; not durable across
container restarts in production — set up Supabase for that).
