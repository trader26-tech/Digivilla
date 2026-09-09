-- ============================================================================
-- Villa bucket funds → allocation % + category + past returns (1/3/5 Yr)
--
-- Extends villa_bucket_funds so a bucket can render the client SIP modal:
-- Scheme · Category · Allocation % · Past Returns (1Y / 3Y / 5Y).
--
-- Idempotent: safe to run repeatedly. Run AFTER 004_reports_networth.sql.
-- ============================================================================

alter table villa_bucket_funds
  add column if not exists category text,        -- Equity / Hybrid / Debt / Other
  add column if not exists ret_1y   numeric,     -- past 1-year return  (% p.a.)
  add column if not exists ret_3y   numeric,     -- past 3-year return  (% p.a.)
  add column if not exists ret_5y   numeric,     -- past 5-year return  (% p.a.)
  add column if not exists sort_order int default 0;
