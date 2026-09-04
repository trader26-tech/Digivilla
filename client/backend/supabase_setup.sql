-- ============================================================================
-- WealthPath — Supabase schema. Run this once in the Supabase SQL Editor.
-- Idempotent: safe to re-run. `users` already exists; the rest are created here.
-- Service-role key (used by the backend) bypasses RLS, so no policies needed
-- for the server. RLS stays ON as a safe default for any anon/public access.
-- ============================================================================

-- 1) funds — the planner's fund universe (mirrors app/funds.py). Optional:
--    the backend falls back to the built-in set if this is empty.
create table if not exists public.funds (
    code            text primary key,
    name            text not null,
    category        text not null,
    asset_class     text not null,      -- equity | debt | hybrid | gold
    risk            text not null,      -- low | moderate | high
    expected_return numeric not null,   -- annualised decimal, e.g. 0.115
    volatility      numeric not null,   -- annualised decimal
    expense_ratio   numeric not null,
    description     text
);
alter table public.funds enable row level security;

insert into public.funds (code, name, category, asset_class, risk, expected_return, volatility, expense_ratio, description) values
  ('EQ_INDEX_NIFTY50','Nifty 50 Index Fund','Large Cap Index','equity','high',0.115,0.16,0.002,'Low-cost passive exposure to India''s 50 largest companies. Core equity holding.'),
  ('EQ_FLEXICAP','Flexi Cap Fund','Flexi Cap','equity','high',0.125,0.18,0.009,'Actively managed across large, mid and small caps. Diversified growth engine.'),
  ('EQ_MIDCAP','Mid Cap Fund','Mid Cap','equity','high',0.135,0.22,0.010,'Higher growth potential from mid-sized companies, with higher swings.'),
  ('EQ_ELSS','ELSS Tax Saver Fund','ELSS (Tax Saving)','equity','high',0.125,0.18,0.009,'Equity fund with a 3-year lock-in and 80C tax benefit.'),
  ('EQ_INTL','Global / US Equity Fund','International Equity','equity','high',0.120,0.19,0.011,'Geographic diversification into developed-market equities.'),
  ('HY_BALANCED','Balanced Advantage Fund','Dynamic Asset Allocation','hybrid','moderate',0.100,0.10,0.008,'Dynamically shifts between equity and debt to cushion volatility.'),
  ('HY_AGGRESSIVE','Aggressive Hybrid Fund','Aggressive Hybrid','hybrid','moderate',0.108,0.12,0.009,'~65-80% equity with a debt buffer. Growth with lower drawdowns than pure equity.'),
  ('DEBT_CORP_BOND','Corporate Bond Fund','Corporate Bond','debt','low',0.072,0.03,0.004,'High-quality corporate debt. Stable returns, low volatility.'),
  ('DEBT_SHORT','Short Duration Debt Fund','Short Duration','debt','low',0.068,0.02,0.003,'Short-maturity bonds. Good for near-term goals and capital preservation.'),
  ('DEBT_LIQUID','Liquid Fund','Liquid','debt','low',0.062,0.008,0.002,'Cash-like, very low risk. For very short horizons and emergency buffers.'),
  ('GOLD_ETF','Gold Fund','Gold','gold','moderate',0.085,0.14,0.005,'Inflation hedge and diversifier, low correlation with equity.')
on conflict (code) do update set
  name=excluded.name, category=excluded.category, asset_class=excluded.asset_class,
  risk=excluded.risk, expected_return=excluded.expected_return,
  volatility=excluded.volatility, expense_ratio=excluded.expense_ratio,
  description=excluded.description;


-- 2) users — auth (email/password AND phone/OTP share this table).
create table if not exists public.users (
    id            text primary key,
    owner         text unique not null,   -- stable id that keys goals/baskets
    email         text unique not null,
    name          text default '',
    salt          text not null,
    password_hash text not null,
    created_at    timestamptz default now()
);
-- Phone/OTP sign-in: phone users have a phone (unique) and no password. These
-- ALTERs make an existing email-only table work for phone accounts too.
-- Idempotent — safe to re-run.
alter table public.users add column if not exists phone text unique;
alter table public.users alter column email drop not null;          -- phone users have no email
alter table public.users alter column password_hash drop not null;  -- and no password
alter table public.users alter column salt drop not null;
create index if not exists users_phone_idx on public.users (phone);
alter table public.users enable row level security;


-- 3) dashboard_funds — the ranked research universe (~1000 funds) written by
--    the AMFI/mfapi ingest job (app/ingest.py) and read by the dashboard.
create table if not exists public.dashboard_funds (
    scheme_code          bigint primary key,
    isin                 text,
    name                 text not null,
    fund_house           text,
    category             text not null,
    bucket               text not null,
    asset_class          text not null,
    plan                 text not null,      -- Regular | Direct
    nav                  numeric,
    nav_date             text,
    return_1y            numeric,
    return_3y            numeric,
    return_5y            numeric,
    cagr_since_inception numeric,
    volatility           numeric,
    max_drawdown         numeric,
    inception_date       text,
    history_points       integer default 0,
    score                numeric default 0,
    rating               integer default 3,
    signals              jsonb   default '[]'::jsonb
);
alter table public.dashboard_funds enable row level security;
create index if not exists dashboard_funds_bucket_idx on public.dashboard_funds (bucket);
create index if not exists dashboard_funds_score_idx  on public.dashboard_funds (score desc);


-- 4) goals — saved goals shown on the Home monitoring screen.
create table if not exists public.goals (
    id                 text primary key,
    owner              text,               -- ties a goal to a user/browser
    goal               text not null,      -- preset key, e.g. 'retirement'
    label              text not null,
    target_amount      numeric not null,
    horizon_years      numeric not null,
    resolved_risk      text not null,
    monthly_investment numeric not null,
    expected_return    numeric not null,
    projected_p50      numeric not null,
    projected_p10      numeric not null,
    projected_p90      numeric not null,
    success_rate       numeric not null,
    recommendations    jsonb default '[]'::jsonb,   -- [{name,asset_class,weight,monthly_amount}]
    created_at         text not null
);
alter table public.goals enable row level security;
create index if not exists goals_owner_idx on public.goals (owner);


-- 5) baskets — user-built fund baskets, optionally linked to a goal.
create table if not exists public.baskets (
    id             text primary key,
    owner          text,
    name           text not null,
    goal_id        text,
    goal_label     text,
    risk           text,
    monthly_amount numeric,
    items          jsonb not null default '[]'::jsonb,  -- [{scheme_code,name,weight,...}]
    created_at     text not null,
    updated_at     text not null
);
alter table public.baskets enable row level security;
create index if not exists baskets_owner_idx   on public.baskets (owner);
create index if not exists baskets_goal_id_idx on public.baskets (goal_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN APP: OTP→PIN sign-in, availability, and per-client documents
-- ═══════════════════════════════════════════════════════════════════════════

-- 6) admin_otp — pending sign-in codes (one row per email; salted hash only).
create table if not exists public.admin_otp (
    email      text primary key,
    code_hash  text not null,
    expires_at text not null,
    attempts   integer not null default 0,
    created_at text not null
);
alter table public.admin_otp enable row level security;

-- 7) admin_devices — trusted devices (30-day cookie), their PIN, auto-lock.
--    Raw device token & PIN are never stored — only hashes.
create table if not exists public.admin_devices (
    device_id    text primary key,
    email        text not null,
    token_hash   text not null,
    pin_hash     text,
    pin_salt     text,
    pin_attempts integer not null default 0,
    lock_minutes integer not null default 30,
    expires_at   text not null,
    created_at   text not null,
    last_used    text,
    revoked      boolean not null default false
);
alter table public.admin_devices enable row level security;

-- 8) admin_config — key/value settings (availability working window lives here).
create table if not exists public.admin_config (
    key   text primary key,
    value jsonb not null default '{}'::jsonb
);
alter table public.admin_config enable row level security;

-- 9) admin_blocked_slots — ISO slot strings the admin marked busy (hidden from clients).
create table if not exists public.admin_blocked_slots (
    slot text primary key
);
alter table public.admin_blocked_slots enable row level security;

-- 10) admin_documents — per-client document metadata (files live in Storage bucket `client-docs`).
create table if not exists public.admin_documents (
    id           text primary key,
    client       text not null,
    filename     text,
    size         integer default 0,
    content_type text,
    path         text,
    placeholder  boolean not null default false,
    created_at   text not null
);
alter table public.admin_documents enable row level security;
create index if not exists admin_documents_client_idx on public.admin_documents (client);

-- Storage bucket for client documents (private). The backend also tries to
-- create this automatically on first upload; run here if you prefer.
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;
