-- ============================================================================
-- Villa bucket funds → sleeve (arbitrage | gold | large | mid | small | other)
--
-- The home screen's PORTFOLIO VALUE allocation bar (client app) paints one
-- coloured segment + label per fund. Its labels/colours used to be POSITIONAL
-- and hardcoded (segment 1 = ARBITRAGE, segment 2 = GOLD, …), which broke the
-- moment the admin defined a different mix. This column lets the admin state,
-- per fund, exactly which sleeve it belongs to, so the bar's label + colour
-- come from real data instead of the row's position.
--
-- `category` (Equity/Hybrid/Debt/Other) is coarser and still drives the returns
-- table — it stays as-is. `sleeve` is the concentration bucket for the home bar.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

alter table villa_bucket_funds
  add column if not exists sleeve text;   -- 'arbitrage' | 'gold' | 'large' | 'mid' | 'small' | 'other'

comment on column villa_bucket_funds.sleeve is
  'Concentration sleeve for the client home allocation bar: arbitrage|gold|large|mid|small|other. NULL falls back to a scheme-name/category scan.';
