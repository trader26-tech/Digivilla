-- ============================================================================
--  Digivilla — sample seed data (matches the reviewed sample tables)
--
--  Run AFTER 003_digivilla.sql. Safe to re-run: it deletes these sample rows by
--  id first, then re-inserts. Deletes ONLY the seed ids below — your real data
--  is untouched. Remove this file's rows later with the DELETEs at the bottom.
--
--  The story: Ravi is building a ₹1L villa by ₹10k SIP (₹60k in, 60% there).
--  Anjali bought a ₹10L villa with a lump sum and earns ₹5,000/mo rent (Sep was
--  reduced). All of it shows on the admin calendar as bookings.
-- ============================================================================

-- clean any prior run of THIS seed (by id)
delete from public.transactions where id in ('t_1','t_2','t_3','t_4','t_5','t_6','t_7','t_8','t_9');
delete from public.bookings     where id in ('b_1','b_2','b_3','b_4');
delete from public.user_villas  where id in ('uv_1','uv_2');
delete from public.villa_funds  where id in ('vf_1','vf_2','vf_3','vf_4','vf_5','vf_6');
delete from public.villas       where id in ('v_1l','v_10l','v_50l');
delete from public.users        where id in ('u_ravi','u_anjali');

-- ── users ───────────────────────────────────────────────────────────────────
insert into public.users (id, phone, email, name, age, city) values
  ('u_ravi',   '9876543210', 'ravi@mail.com',   'Ravi Kumar',   34, 'Chennai'),
  ('u_anjali', '9000011111', 'anjali@mail.com', 'Anjali Menon', 41, 'Kochi');

-- ── villas ──────────────────────────────────────────────────────────────────
insert into public.villas (id, name, price, rent_monthly, target_growth, income_pays, sort_order) values
  ('v_1l',  'Starter Villa',  100000,      0, 13.5, false, 1),
  ('v_10l', 'Estate Villa',  1000000,   5000, 11.2, true,  2),
  ('v_50l', 'Manor Villa',   5000000,  27000, 10.4, true,  3);

-- ── villa_funds (the ₹1L and ₹10L concentrations) ────────────────────────────
insert into public.villa_funds (id, villa_id, scheme_code, fund_name, weight, role, withdraw_monthly, sort_order) values
  ('vf_1', 'v_1l',  122640, 'Parag Parikh Flexi Cap',     0.45, 'growth', 0,    1),
  ('vf_2', 'v_1l',  100119, 'HDFC Balanced Advantage',    0.30, 'hedge',  0,    2),
  ('vf_3', 'v_1l',  105758, 'HDFC Mid-Cap Opportunities', 0.25, 'growth', 0,    3),
  ('vf_4', 'v_10l', 105968, 'Kotak Equity Arbitrage',     0.40, 'income', 5000, 1),
  ('vf_5', 'v_10l', 103340, 'ICICI Pru Liquid',           0.10, 'liquid', 0,    2),
  ('vf_6', 'v_10l', 122640, 'Parag Parikh Flexi Cap',     0.50, 'growth', 0,    3);

-- ── user_villas ──────────────────────────────────────────────────────────────
insert into public.user_villas (id, user_id, villa_id, status, sip_monthly, sip_day, sip_next_payment, current_value, started_at) values
  ('uv_1', 'u_ravi',   'v_1l',  'accumulating', 10000, 5, date '2026-10-05',  62400, timestamptz '2026-07-05'),
  ('uv_2', 'u_anjali', 'v_10l', 'active',            0, null, null,          1048000, timestamptz '2026-06-10');

-- ── transactions (the one ledger) ────────────────────────────────────────────
insert into public.transactions (id, user_villa_id, kind, amount, txn_date, status, note) values
  ('t_1', 'uv_1', 'sip',         10000, date '2026-07-05', 'paid',    ''),
  ('t_2', 'uv_1', 'sip',         10000, date '2026-08-05', 'paid',    ''),
  ('t_3', 'uv_1', 'sip',         10000, date '2026-09-05', 'paid',    ''),
  ('t_4', 'uv_1', 'lump_sum',    30000, date '2026-08-20', 'paid',    'Diwali bonus'),
  ('t_5', 'uv_2', 'lump_sum',  1000000, date '2026-06-10', 'paid',    ''),
  ('t_6', 'uv_2', 'rent',         5000, date '2026-07-01', 'paid',    ''),
  ('t_7', 'uv_2', 'rent',         5000, date '2026-08-01', 'paid',    ''),
  ('t_8', 'uv_2', 'rent',         4500, date '2026-09-01', 'reduced', 'arbitrage sleeve low'),
  ('t_9', 'uv_2', 'withdrawal',      0, date '2026-09-04', 'pending', 'requested Rs 3.5L');

-- ── bookings (the admin calendar) ────────────────────────────────────────────
insert into public.bookings (id, user_id, villa_id, name, phone, kind, amount, slot, status, created_at) values
  ('b_1', 'u_ravi',   'v_1l',  'Ravi Kumar',   '9876543210', 'sip',           10000, '',                  'requested', timestamptz '2026-09-05'),
  ('b_2', 'u_anjali', 'v_10l', 'Anjali Menon', '9000011111', 'withdraw',     350000, '',                  'requested', timestamptz '2026-09-04'),
  ('b_3', 'u_anjali', 'v_50l', 'Anjali Menon', '9000011111', 'consultation',      0, '2026-09-08T10:30',  'confirmed', timestamptz '2026-09-02'),
  ('b_4', null,       'v_1l',  'Priya Nair',   '9445566778', 'consultation',      0, '2026-09-03T16:00',  'declined',  timestamptz '2026-09-01');

-- ── verify: these should reconcile ───────────────────────────────────────────
-- Ravi invested  (expect 60000):
--   select sum(amount) from transactions where user_villa_id='uv_1' and kind in ('sip','lump_sum');
-- Anjali rent received (expect 14500):
--   select sum(amount) from transactions where user_villa_id='uv_2' and kind='rent' and status<>'skipped';

-- ── to remove this sample data later, run the DELETEs at the top of the file. ──
