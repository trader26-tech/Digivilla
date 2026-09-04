-- ============================================================================
-- Digivilla Admin — Supabase schema. Run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run). Idempotent: safe to re-run.
-- The backend uses the service-role key, which bypasses RLS, so no policies are
-- needed for the server. RLS stays ON as a safe default.
--
-- Until these tables exist, the admin API falls back to local JSON files (which
-- are NOT durable on Railway — they reset on every redeploy). Run this to make
-- bookings / availability / documents persist and stay in sync with the client.
-- ============================================================================

-- bookings — consultation requests from the client app; the admin confirms them.
create table if not exists public.bookings (
    id          text primary key,
    name        text not null,
    phone       text not null,
    property    text not null default 'land',
    variant     text default '',
    plots       integer not null default 1,
    amount      double precision not null default 0,
    slot        text not null,
    note        text default '',
    status      text not null default 'requested',  -- requested | confirmed | declined
    created_at  text not null
);
alter table public.bookings enable row level security;
create index if not exists bookings_slot_idx on public.bookings (slot);

-- admin_otp — pending sign-in codes (one row per email; salted hash only).
create table if not exists public.admin_otp (
    email      text primary key,
    code_hash  text not null,
    expires_at text not null,
    attempts   integer not null default 0,
    created_at text not null
);
alter table public.admin_otp enable row level security;

-- admin_devices — trusted devices (30-day cookie), their PIN, auto-lock.
-- Raw device token & PIN are never stored — only hashes.
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

-- admin_config — key/value settings (availability working window lives here).
create table if not exists public.admin_config (
    key   text primary key,
    value jsonb not null default '{}'::jsonb
);
alter table public.admin_config enable row level security;

-- admin_blocked_slots — ISO slot strings the admin marked busy (hidden from clients).
create table if not exists public.admin_blocked_slots (
    slot text primary key
);
alter table public.admin_blocked_slots enable row level security;

-- admin_documents — per-client document metadata (files live in Storage bucket `client-docs`).
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
-- create this on first upload; running it here is optional.
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;
