-- ============================================================================
--  Digivilla — core schema (villas · ownership · money ledger · calendar)
--
--  Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query →
--  paste → Run). Idempotent: safe to re-run. The backend uses the service-role
--  key, which bypasses RLS, so no policies are needed for the server.
--
--  Six tables:
--    users          – accounts (extends the existing table; adds nothing that
--                     breaks the current phone/email sign-in)
--    villas         – the catalogue: one row per ticket size (₹1L, ₹10L, …)
--    villa_funds    – the concentration: which mutual funds make up a villa
--    user_villas    – who owns / is buying which villa (SIP settings live here)
--    transactions   – ONE ledger for every rupee: sip · lump_sum · rent · withdrawal
--    bookings       – the admin calendar: every client request
--
--  Design: nothing is stored twice. "invested" and "rent received" are sums of
--  `transactions`, never cached columns — so there is nothing to keep in sync.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- users  (additive — the existing table already has id/phone/email/name/…)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
    id             text primary key,                 -- uuid4 hex
    phone          text unique,                      -- phone/OTP login key
    email          text unique,                      -- email login (nullable)
    name           text not null default '',
    age            integer,
    city           text,
    salt           text not null default '',         -- empty for phone accounts
    password_hash  text not null default '',         -- empty for phone accounts
    created_at     timestamptz not null default now()
);
-- add the profile columns if an older users table is missing them (safe):
alter table public.users add column if not exists age  integer;
alter table public.users add column if not exists city text;
create index if not exists users_phone_idx on public.users (phone);


-- ────────────────────────────────────────────────────────────────────────────
-- villas — the catalogue, one row per ticket size
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.villas (
    id             text primary key,                 -- uuid4 hex or a slug ('v_10l')
    name           text not null,                    -- 'Estate Villa'
    price          double precision not null,        -- ticket size (₹)
    rent_monthly   double precision not null default 0,   -- rent it targets (₹/mo); 0 = none
    target_growth  double precision not null default 0,   -- headline % p.a.
    blurb          text not null default '',
    income_pays    boolean not null default true,    -- false for a pure-growth villa
    sort_order     integer not null default 0,
    active         boolean not null default true,
    created_at     timestamptz not null default now()
);
create index if not exists villas_sort_idx on public.villas (sort_order);


-- ────────────────────────────────────────────────────────────────────────────
-- villa_funds — the concentration: the funds that make up each villa
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.villa_funds (
    id               text primary key,               -- uuid4 hex
    villa_id         text not null references public.villas(id) on delete cascade,
    scheme_code      integer not null,               -- AMFI scheme code
    fund_name        text not null,                  -- fund name shown to the customer
    weight           double precision not null,      -- 0..1 of the ticket (a villa's weights sum to 1)
    role             text not null default 'growth', -- income | growth | liquid | hedge
    withdraw_monthly double precision not null default 0,   -- rent drawn from THIS leg (₹)
    note             text not null default '',
    sort_order       integer not null default 0
);
create index if not exists villa_funds_villa_idx on public.villa_funds (villa_id);


-- ────────────────────────────────────────────────────────────────────────────
-- user_villas — who owns / is buying which villa; the SIP lives on this row
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_villas (
    id                text primary key,              -- uuid4 hex
    user_id           text not null references public.users(id) on delete cascade,
    villa_id          text not null references public.villas(id),
    status            text not null default 'accumulating', -- accumulating | active | exited
    sip_monthly       double precision not null default 0,  -- 0 = no SIP (lump-sum only)
    sip_day           integer,                       -- day of month the SIP is due
    sip_next_payment  date,                          -- when the next SIP is due
    current_value     double precision not null default 0,  -- latest mark-to-market (₹)
    started_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists user_villas_user_idx  on public.user_villas (user_id);
create index if not exists user_villas_villa_idx on public.user_villas (villa_id);


-- ────────────────────────────────────────────────────────────────────────────
-- transactions — the single money ledger (money IN and money OUT)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.transactions (
    id             text primary key,                 -- uuid4 hex
    user_villa_id  text not null references public.user_villas(id) on delete cascade,
    kind           text not null,                    -- sip | lump_sum | rent | withdrawal
    amount         double precision not null default 0,   -- ₹
    txn_date       date not null,                    -- when it happened
    status         text not null default 'paid',     -- paid | pending | reduced | skipped | failed
    note           text not null default '',
    reference      text not null default '',         -- payment/UTR reference, optional
    created_at     timestamptz not null default now()
);
create index if not exists transactions_uv_idx    on public.transactions (user_villa_id);
create index if not exists transactions_kind_idx  on public.transactions (kind);
create index if not exists transactions_date_idx  on public.transactions (txn_date);


-- ────────────────────────────────────────────────────────────────────────────
-- bookings — the admin calendar feed (client requests)
--   Extends the existing bookings table: adds user_id + villa_id.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.bookings (
    id           text primary key,                   -- uuid4 hex
    user_id      text references public.users(id) on delete set null,  -- null for a walk-in
    villa_id     text references public.villas(id) on delete set null,
    name         text not null,                      -- snapshot at request time
    phone        text not null,                      -- snapshot at request time
    kind         text not null default 'consultation',  -- consultation | sip | buy | withdraw
    amount       double precision not null default 0,
    plots        integer not null default 1,
    slot         text default '',                    -- ISO-8601 datetime (consultation only)
    note         text default '',
    status       text not null default 'requested',  -- requested | confirmed | declined
    meet_link    text default '',                    -- Google Meet / video link for the session
    created_at   timestamptz not null default now()
);
-- If bookings already exists from the old schema, add the new links (safe):
alter table public.bookings add column if not exists user_id   text references public.users(id) on delete set null;
alter table public.bookings add column if not exists villa_id  text references public.villas(id) on delete set null;
alter table public.bookings add column if not exists meet_link text default '';
create index if not exists bookings_user_idx    on public.bookings (user_id);
create index if not exists bookings_status_idx  on public.bookings (status);
create index if not exists bookings_slot_idx    on public.bookings (slot);
create index if not exists bookings_created_idx on public.bookings (created_at);


-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security — on by default; the server's service-role key bypasses it.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.users        enable row level security;
alter table public.villas       enable row level security;
alter table public.villa_funds  enable row level security;
alter table public.user_villas  enable row level security;
alter table public.transactions enable row level security;
alter table public.bookings     enable row level security;
