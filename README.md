# Goal Planner

A **goal-based mutual-fund investment app**, built by a mutual fund distributor
and distributed as a **PWA** (shared via a YouTube link — tap the link, the app
opens instantly, installable to the home screen).

**The product vision.** The app is goal-first. When someone opens the link, the
**very first screen has no login** — it is a beautiful goal picker: a grid of the
life goals a person invests for (retirement, a house, a child's education, a car,
a wedding, a dream vacation, wealth, an emergency fund), each with its own icon
and subtle, lively animation. The user picks the goal that matches their dream
before we ask anything else. Only later — when they want to *save* a plan — does
auth come in. Everything downstream (amount, timeline, SIP math, Monte Carlo,
fund recommendations) hangs off that first goal choice.

The engine behind it: a decision-tree flow listens to your goal, the target
amount, and the timeline, then computes the **monthly SIP you need**, runs a
**Monte Carlo simulation** of likely outcomes, and **recommends specific mutual
funds with a rationale**.

- **Backend** — FastAPI. Planning math, Monte Carlo engine, fund selection.
  Optionally reads the fund universe from Supabase; falls back to a curated
  built-in set.
- **Frontend** — Angular. Conversational step-by-step UI with an SVG projection
  chart, allocation breakdown, and fund cards.

## Repo layout

Two independently deployable apps in one repo:

- **`client/`** — the main app: FastAPI backend (`client/backend`) + Angular PWA
  (`client/frontend`). In production the backend serves the built frontend, so
  they share one origin.
- **`admin/`** — a standalone Angular admin app (the consultation desk) that
  talks to the client's backend. See [admin/README.md](admin/README.md).

## Run locally

**Backend** (`http://localhost:8000`)

```bash
cd client/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional: add Supabase keys
uvicorn app.main:app --reload --port 8000
```

**Frontend** (`http://localhost:4200`)

```bash
cd client/frontend
npm install
npm start
```

Open http://localhost:4200.

**Admin app** (`http://localhost:4300`, optional)

```bash
cd admin
npm install
npm start
```

## Deploy

Two Railway services — one for `client/`, one for `admin/` — each with its Root
Directory set to that folder. Full steps in [DEPLOYMENT.md](DEPLOYMENT.md).

## How the planning math works

The required monthly SIP is sized against the **median** compound growth rate
(expected return minus half the variance — i.e. accounting for volatility drag),
not the arithmetic mean. This makes the plan realistic: the *typical* outcome
meets the target rather than only the lucky one. The Monte Carlo pass then shows
the p10 / p50 / p90 range and the probability of hitting the goal.

> Projections use simulated long-run category assumptions. Not investment advice.
