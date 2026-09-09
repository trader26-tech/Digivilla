-- ============================================================================
-- User-editable estate name + city (client Settings)
--
-- The estate greeting ("<name>'s City") defaults to the first word of the
-- client's real admin record (client_master.name), but the user can override it
-- in Settings. These columns hold that override; empty = use the default.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

alter table users
  add column if not exists estate_name text,   -- custom "<name>'s City" name
  add column if not exists estate_city text;    -- custom city / nickname
