# Daily NAV refresh — Railway cron setup

Indian mutual-fund NAVs publish **once per day** (finalized ~11 PM–1 AM IST) and
don't change intraday, so there's nothing to stream over WebSockets. The app
keeps the latest NAV per scheme in the Supabase table `scheme_nav_cache` and
reads from it instantly (shared across workers, survives restarts).

Freshness is guaranteed **two ways** — you only strictly need the first:

1. **Refresh-on-read (already active, no setup):** `app/nav_cache.get_nav()` — if
   a scheme's cached `nav_date` isn't today's, it fetches the latest from mfapi
   once and upserts it. So even with no cron, the first request after the daily
   publish self-heals the cache.

2. **Daily cron (proactive, recommended):** warms every held scheme right after
   the publish so the first user of the day never pays the fetch.

## Add the cron on Railway (one-time, ~2 min)

The client Docker image already contains the script (`python -m scripts.refresh_navs`).

1. Railway → project **Digivilla** → **New → Empty Service** (or "Add service" →
   from the same GitHub repo / same image as **Client - Digivilla**).
2. Name it **`NAV Cron`**.
3. Settings:
   - **Root Directory / Dockerfile**: same as the client service
     (`client/Dockerfile`, root context) — or reuse the client image.
   - **Start Command**: `python -m scripts.refresh_navs`
   - **Cron Schedule**: `30 19 * * *`  ← 19:30 UTC = **01:00 IST**, after the
     AMFI publish. (Railway crons run in UTC.)
   - **Variables**: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (same as the client
     service — the script writes `scheme_nav_cache`).
4. Deploy. Railway will run the command on schedule; the container exits when the
   refresh finishes (crons are one-shot).

The script only refreshes the schemes actually in use (client holdings + villa
bucket funds) and skips any already stamped with today's NAV, so a run is cheap
and a re-run/retry is nearly free.

Run it manually anytime:  `railway run --service "NAV Cron" python -m scripts.refresh_navs`
or locally:               `python -m scripts.refresh_navs`
