-- ============================================================================
--  MyLakshyas — complete Supabase / Postgres schema
--
--  Run this whole file in the Supabase SQL editor. It DROPS every app table
--  first, then recreates them to match exactly what the backend reads/writes.
--
--  Tables:
--    users            – accounts (email/password OR phone/OTP)
--    goals            – a user's saved goals (Monte-Carlo plan snapshot)
--    baskets          – saved fund baskets
--    funds            – optional custom fund universe for the planner engine
--    dashboard_funds  – the scored mutual-fund universe powering the explorer
--
--  Storage keys on `owner` (usr_<hex>); the app also runs without any of this
--  (local JSON fallback), so these tables are only needed once you use Supabase.
-- ============================================================================

-- ---- DROP EVERYTHING (safe re-run) ----------------------------------------
DROP TABLE IF EXISTS goals            CASCADE;
DROP TABLE IF EXISTS baskets          CASCADE;
DROP TABLE IF EXISTS dashboard_funds  CASCADE;
DROP TABLE IF EXISTS funds            CASCADE;
DROP TABLE IF EXISTS users            CASCADE;


-- ============================================================================
--  users
--  Email/password accounts AND phone/OTP accounts share this table.
--  Phone users have empty email + password (see backend/app/phone_auth.py).
-- ============================================================================
CREATE TABLE users (
    id             text PRIMARY KEY,                 -- uuid4 hex
    owner          text UNIQUE NOT NULL,             -- usr_<hex>, keys goals/baskets
    email          text UNIQUE,                      -- nullable: phone users have none
    phone          text UNIQUE,                      -- nullable: email users have none
    name           text NOT NULL DEFAULT '',
    salt           text NOT NULL DEFAULT '',         -- empty for phone accounts
    password_hash  text NOT NULL DEFAULT '',         -- empty for phone accounts
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_owner_idx ON users (owner);
CREATE INDEX users_email_idx ON users (email);
CREATE INDEX users_phone_idx ON users (phone);


-- ============================================================================
--  goals
--  One row per saved goal. Columns mirror schemas.Goal / GoalCreate.
--  `recommendations` is a JSON array of {name, asset_class, weight, monthly_amount}.
-- ============================================================================
CREATE TABLE goals (
    id                 text PRIMARY KEY,             -- uuid4 hex
    owner              text,                          -- usr_<hex> or a browser id (nullable)
    goal               text NOT NULL,                 -- preset key, e.g. "retirement"
    label              text NOT NULL,
    target_amount      double precision NOT NULL,
    horizon_years      double precision NOT NULL,
    resolved_risk      text NOT NULL,
    monthly_investment double precision NOT NULL,
    expected_return    double precision NOT NULL,
    projected_p50      double precision NOT NULL,
    projected_p10      double precision NOT NULL,
    projected_p90      double precision NOT NULL,
    success_rate       double precision NOT NULL,
    recommendations    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at         text NOT NULL                  -- ISO-8601 string (app-generated)
);
CREATE INDEX goals_owner_idx ON goals (owner);


-- ============================================================================
--  baskets
--  Saved fund baskets. `items` is a JSON array of BasketItem objects
--  (scheme_code, name, bucket, asset_class, rating, return_1y/3y/5y, weight, ...).
-- ============================================================================
CREATE TABLE baskets (
    id             text PRIMARY KEY,                 -- uuid4 hex
    owner          text,                              -- usr_<hex> or browser id (nullable)
    name           text NOT NULL,
    goal_id        text,                              -- optional link to goals.id
    goal_label     text,
    risk           text,
    monthly_amount double precision,
    items          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at     text NOT NULL,                     -- ISO-8601 string
    updated_at     text NOT NULL                      -- ISO-8601 string
);
CREATE INDEX baskets_owner_idx ON baskets (owner);


-- ============================================================================
--  funds  (OPTIONAL)
--  A custom fund universe for the planner engine. If empty/absent the backend
--  falls back to the built-in universe in app/funds.py. Columns mirror the
--  Fund model read in app/main.py:load_fund_universe().
-- ============================================================================
CREATE TABLE funds (
    code            text PRIMARY KEY,
    name            text NOT NULL,
    category        text NOT NULL,
    asset_class     text NOT NULL,
    risk            text NOT NULL,
    expected_return double precision NOT NULL,
    volatility      double precision NOT NULL,
    expense_ratio   double precision NOT NULL,
    description     text NOT NULL DEFAULT ''
);


-- ============================================================================
--  dashboard_funds
--  The scored mutual-fund universe that powers the explorer/dashboard, written
--  in bulk by app/ingest.py (delete-all then insert). Columns mirror ingest.to_row().
--  `signals` is a JSON array of strings.
-- ============================================================================
CREATE TABLE dashboard_funds (
    scheme_code          integer PRIMARY KEY,
    isin                 text,
    name                 text NOT NULL,
    fund_house           text,
    category             text,
    bucket               text,
    asset_class          text,
    plan                 text,
    nav                  double precision,
    nav_date             text,
    return_1y            double precision,
    return_3y            double precision,
    return_5y            double precision,
    cagr_since_inception double precision,
    volatility           double precision,
    max_drawdown         double precision,
    inception_date       text,
    history_points       integer DEFAULT 0,
    score                double precision,
    rating               integer,
    signals              jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX dashboard_funds_asset_class_idx ON dashboard_funds (asset_class);
CREATE INDEX dashboard_funds_bucket_idx      ON dashboard_funds (bucket);
CREATE INDEX dashboard_funds_score_idx       ON dashboard_funds (score DESC);


-- ============================================================================
--  Row Level Security
--  The backend uses the SERVICE-ROLE key (which bypasses RLS), so leaving RLS
--  off is fine for server-only access. If you ever expose these tables to the
--  anon/public key from the browser, enable RLS and add owner-scoped policies:
--
--    ALTER TABLE goals   ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE baskets ENABLE ROW LEVEL SECURITY;
--    -- then add policies keyed on your auth uid <-> owner mapping.
-- ============================================================================
