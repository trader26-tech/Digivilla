-- Profile fields for phone-verified users (name/email are already columns).
-- Run once in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
--
-- Until this runs, sign-in still works and name+email save; age/city simply
-- aren't persisted (the backend degrades gracefully). After it runs, age/city
-- persist and show on the account page.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text UNIQUE;   -- phone sign-in key
ALTER TABLE users ADD COLUMN IF NOT EXISTS age  integer;        -- optional profile
ALTER TABLE users ADD COLUMN IF NOT EXISTS city text;           -- optional profile

-- Phone accounts have no password / email at first:
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
