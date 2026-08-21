# Goal Planner

A goal-based financial planner. A decision-tree chatbot listens to your goal
(retirement, house, child's education, …), the target amount, and the timeline,
then computes the **monthly SIP you need**, runs a **Monte Carlo simulation** of
likely outcomes, and **recommends specific mutual funds with a rationale**.

- **Backend** — FastAPI. Planning math, Monte Carlo engine, fund selection.
  Optionally reads the fund universe from Supabase; falls back to a curated
  built-in set.
- **Frontend** — Angular. Conversational step-by-step UI with an SVG projection
  chart, allocation breakdown, and fund cards.

## Run locally

**Backend** (`http://localhost:8000`)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional: add Supabase keys
uvicorn app.main:app --reload --port 8000
```

**Frontend** (`http://localhost:4200`)

```bash
cd frontend
npm install
npm start
```

Open http://localhost:4200.

## Deploy

Single combined service on Railway — see [DEPLOYMENT.md](DEPLOYMENT.md).
The `Dockerfile` builds Angular and serves it from FastAPI on one URL.

## How the planning math works

The required monthly SIP is sized against the **median** compound growth rate
(expected return minus half the variance — i.e. accounting for volatility drag),
not the arithmetic mean. This makes the plan realistic: the *typical* outcome
meets the target rather than only the lucky one. The Monte Carlo pass then shows
the p10 / p50 / p90 range and the probability of hitting the goal.

> Projections use simulated long-run category assumptions. Not investment advice.
