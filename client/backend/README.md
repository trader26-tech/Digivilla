# Backend (FastAPI + Supabase)

FastAPI service that talks to Supabase via `supabase-py` using the service-role key.
Exposes a simple `items` CRUD API.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # then fill in your Supabase URL + service key
```

Create the table in Supabase: open the SQL editor and run [`schema.sql`](schema.sql).

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

## Endpoints

| Method | Path           | Description        |
| ------ | -------------- | ------------------ |
| GET    | `/health`      | Liveness check     |
| GET    | `/items`       | List items         |
| POST   | `/items`       | Create an item     |
| DELETE | `/items/{id}`  | Delete an item     |
