-- ============================================================================
-- Manual transaction → villa mapping (admin)
--
-- Two new tables let the admin open a client, see their individual transactions
-- (one row per report line), assign each to a specific villa, and set that
-- villa's status + gold coin by hand — overriding the automatic ₹5L logic.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

-- 1 · admin-created villa instances, per client -----------------------------
create table if not exists client_villas (
  id           uuid primary key default gen_random_uuid(),
  client_code  text        not null,
  name         text        not null default 'Villa',
  status       text        not null default 'building'
                 check (status in ('building', 'constructed')),
  coin         boolean     not null default false,   -- gold coin / SWP active
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_client_villas_code on client_villas (client_code);

-- 2 · raw per-transaction rows (one per report line), keyed by AMC Order Id --
--    Upserted by order_id on every upload → new txns are added and any manual
--    villa_id mapping already set is PRESERVED across re-uploads.
create table if not exists client_transactions (
  order_id     text        primary key,              -- AMC order reference (stable)
  client_code  text        not null,
  txn_date     text,                                  -- NAV/order date from the report
  scheme_name  text        not null,
  scheme_code  int,                                   -- resolved mfapi code
  folio_no     text,
  kind         text,                                  -- SIP / Lumpsum / …
  amount       numeric     not null default 0,
  nav          numeric,
  units        numeric     not null default 0,
  villa_id     uuid        references client_villas(id) on delete set null,
  report_date  date,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_client_txns_code  on client_transactions (client_code);
create index if not exists idx_client_txns_villa on client_transactions (villa_id);
