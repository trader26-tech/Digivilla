-- ============================================================================
-- Villa buckets → kind (sip | lumpsum) + subtitle
--
-- A bucket is either a SIP plan or a Lumpsum plan. The client shows both via a
-- "Choose A Bucket" picker; the modal title reads "Sip - <name>" / "Lumpsum -
-- <name>" and shows the subtitle (e.g. "medium risk portfolio").
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

alter table villa_buckets
  add column if not exists kind     text default 'sip',   -- 'sip' | 'lumpsum'
  add column if not exists subtitle text;                 -- e.g. 'medium risk portfolio'
