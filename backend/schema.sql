-- Optional: run in the Supabase SQL editor to store the fund universe in the DB.
-- The backend works WITHOUT this (it falls back to app/funds.py). Seeding here
-- lets you tune assumptions without redeploying code.

create table if not exists public.funds (
    code text primary key,
    name text not null,
    category text not null,
    asset_class text not null,          -- equity | debt | hybrid | gold
    risk text not null,                 -- low | moderate | high
    expected_return numeric not null,   -- annualised decimal, e.g. 0.115
    volatility numeric not null,        -- annualised decimal
    expense_ratio numeric not null,
    description text
);

alter table public.funds enable row level security;

-- Seed rows mirror app/funds.py FUND_UNIVERSE.
insert into public.funds (code, name, category, asset_class, risk, expected_return, volatility, expense_ratio, description) values
  ('EQ_INDEX_NIFTY50','Nifty 50 Index Fund','Large Cap Index','equity','high',0.115,0.16,0.002,'Low-cost passive exposure to India''s 50 largest companies. Core equity holding.'),
  ('EQ_FLEXICAP','Flexi Cap Fund','Flexi Cap','equity','high',0.125,0.18,0.009,'Actively managed across large, mid and small caps. Diversified growth engine.'),
  ('EQ_MIDCAP','Mid Cap Fund','Mid Cap','equity','high',0.135,0.22,0.010,'Higher growth potential from mid-sized companies, with higher swings.'),
  ('EQ_ELSS','ELSS Tax Saver Fund','ELSS (Tax Saving)','equity','high',0.125,0.18,0.009,'Equity fund with a 3-year lock-in and 80C tax benefit.'),
  ('EQ_INTL','Global / US Equity Fund','International Equity','equity','high',0.120,0.19,0.011,'Geographic diversification into developed-market equities.'),
  ('HY_BALANCED','Balanced Advantage Fund','Dynamic Asset Allocation','hybrid','moderate',0.100,0.10,0.008,'Dynamically shifts between equity and debt to cushion volatility.'),
  ('HY_AGGRESSIVE','Aggressive Hybrid Fund','Aggressive Hybrid','hybrid','moderate',0.108,0.12,0.009,'~65-80% equity with a debt buffer. Growth with lower drawdowns than pure equity.'),
  ('DEBT_CORP_BOND','Corporate Bond Fund','Corporate Bond','debt','low',0.072,0.03,0.004,'High-quality corporate debt. Stable returns, low volatility.'),
  ('DEBT_SHORT','Short Duration Debt Fund','Short Duration','debt','low',0.068,0.02,0.003,'Short-maturity bonds. Good for near-term goals and capital preservation.'),
  ('DEBT_LIQUID','Liquid Fund','Liquid','debt','low',0.062,0.008,0.002,'Cash-like, very low risk. For very short horizons and emergency buffers.'),
  ('GOLD_ETF','Gold Fund','Gold','gold','moderate',0.085,0.14,0.005,'Inflation hedge and diversifier, low correlation with equity.')
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  asset_class = excluded.asset_class,
  risk = excluded.risk,
  expected_return = excluded.expected_return,
  volatility = excluded.volatility,
  expense_ratio = excluded.expense_ratio,
  description = excluded.description;
