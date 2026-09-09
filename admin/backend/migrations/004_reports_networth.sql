-- ============================================================================
-- Daily reports → client net worth & villa live pricing (admin)
--
-- Two reports are uploaded each day (User Report + Transaction Report). We keep
-- the raw file as PROOF (Supabase Storage bucket `admin-reports`) and the parsed
-- rows in tables. One report per type per day — re-uploading replaces that day.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

-- 1 · one row per uploaded file (proof + parse status) -----------------------
create table if not exists report_uploads (
  id            uuid primary key default gen_random_uuid(),
  report_date   date        not null,
  report_type   text        not null check (report_type in ('user', 'transaction')),
  filename      text        not null,
  storage_path  text,                       -- path in the admin-reports bucket
  size_bytes    bigint,
  row_count     int         default 0,
  status        text        default 'parsed',
  uploaded_at   timestamptz not null default now(),
  -- one report per type per day → re-upload overwrites
  unique (report_date, report_type)
);
create index if not exists idx_report_uploads_date on report_uploads (report_date desc);

-- 2 · client master — parsed from the User Report ----------------------------
create table if not exists client_master (
  client_code   text primary key,           -- "Code" / "Client Code" — the join key
  name          text,
  pan           text,
  phone         text,
  email         text,
  dob           text,
  address       text,
  city          text,
  state         text,
  pin           text,
  signup        text,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_client_master_name on client_master (lower(name));

-- 3 · holdings — parsed from the Transaction Report, aggregated per scheme ----
--    Rebuilt from the LATEST transaction report each upload.
create table if not exists client_holdings (
  id            uuid primary key default gen_random_uuid(),
  client_code   text        not null,
  scheme_name   text        not null,       -- raw scheme name from the report
  scheme_code   int,                        -- resolved mfapi.in REGULAR-plan code
  folio_no      text,
  units         numeric     not null default 0,
  invested      numeric     not null default 0,  -- sum of Amount
  last_nav      numeric,                    -- NAV from the report (cost-basis ref)
  report_date   date,
  updated_at    timestamptz not null default now(),
  unique (client_code, scheme_name, folio_no)
);
create index if not exists idx_holdings_client on client_holdings (client_code);
create index if not exists idx_holdings_scheme on client_holdings (scheme_code);

-- 4 · villa buckets — the admin-defined "buckets for a bill" ------------------
--    A villa = a named set of schemes. A client "owns" a villa when they hold
--    its schemes; value = Σ units × live regular-plan NAV.
create table if not exists villa_buckets (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,        -- "Arbitrage Villa", "₹10L Villa"…
  tier          text,                        -- optional: 1L / 10L / 50L / 1Cr
  sort_order    int         default 0,
  created_at    timestamptz not null default now()
);

create table if not exists villa_bucket_funds (
  id            uuid primary key default gen_random_uuid(),
  bucket_id     uuid        not null references villa_buckets(id) on delete cascade,
  scheme_name   text        not null,        -- display name
  scheme_code   int,                         -- mfapi.in regular-plan code
  target_weight numeric     default 0,       -- % of the villa (optional)
  unique (bucket_id, scheme_code)
);
create index if not exists idx_bucket_funds_bucket on villa_bucket_funds (bucket_id);

-- 5 · scheme NAV cache — resolved code + latest live regular-plan NAV --------
create table if not exists scheme_nav_cache (
  scheme_code   int primary key,
  scheme_name   text,
  nav           numeric,
  nav_date      text,
  fetched_at    timestamptz not null default now()
);

-- 6 · a lookup so we never re-resolve the same raw name → code ---------------
create table if not exists scheme_code_map (
  raw_name      text primary key,            -- normalized raw scheme name
  scheme_code   int,                         -- resolved regular-plan code (null = unresolved)
  resolved_name text,
  updated_at    timestamptz not null default now()
);
