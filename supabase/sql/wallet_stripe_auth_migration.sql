-- ============================================================================
-- WALLET / STRIPE / SUPABASE AUTH MIGRATION
-- ============================================================================
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste this whole file -> Run) *before* deploying the new Edge
-- Functions in supabase/functions/. It is written to be safe to re-run.
--
-- What this does, in plain terms:
--   1. Adds a `balance` (wallet) to every member's account, plus a ledger
--      (`wallet_transactions`) recording every top-up/spend/refund.
--   2. Links each `users` row to a real Supabase Auth account
--      (`auth_user_id`), which the login/registration/password-reset flow
--      now relies on instead of the old home-grown `password_hash` system.
--   3. Locks down the columns that represent real money or membership/
--      payment state so the browser can never write to them directly - only
--      the Edge Functions (using the service_role key) can, after verifying
--      who's calling and that the numbers actually add up. This is the fix
--      for the "anyone with dev tools can rewrite their own balance/role"
--      problem that a client-writable wallet would otherwise have.
--
-- See supabase/functions/README.md for the full end-to-end setup (Stripe
-- account, webhook, secrets, custom SMTP, deploying functions, and running
-- the one-off password migration).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Supabase Auth linkage
-- ----------------------------------------------------------------------------
alter table users add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- New registrations no longer write password_hash at all (Supabase Auth owns
-- the password now) - without this, every new sign-up would fail with a
-- NOT NULL violation.
alter table users alter column password_hash drop not null;

-- ----------------------------------------------------------------------------
-- 2) Wallet balance
-- ----------------------------------------------------------------------------
alter table users add column if not exists balance numeric(10,2) not null default 0;
alter table users add column if not exists stripe_customer_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_balance_non_negative'
  ) then
    alter table users add constraint users_balance_non_negative check (balance >= 0);
  end if;
end $$;

-- Every credit/debit against a member's balance - top-ups, event fees,
-- event refunds, membership purchases, merch orders, and manual admin
-- corrections (e.g. a bank-transfer refund handled outside Stripe). This is
-- the per-member equivalent of the club-wide `finance_transactions` ledger
-- that already exists - both get written to for anything that moves money,
-- they just answer different questions ("what's my balance history" vs.
-- "what's the club's income/expenditure").
create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount numeric(10,2) not null, -- positive = credit, negative = debit
  balance_after numeric(10,2) not null,
  type text not null, -- 'topup' | 'event_fee' | 'event_refund' | 'membership' | 'merch' | 'admin_adjustment'
  reference_id uuid, -- signups.id / merchandise_orders.id, where relevant
  stripe_session_id text,
  stripe_payment_intent_id text,
  note text,
  created_by text, -- admin username, only set for 'admin_adjustment'
  created_at timestamptz not null default now()
);
create index if not exists wallet_transactions_user_id_idx on wallet_transactions (user_id);

-- Stripe retries webhook delivery until it gets a 2xx, so the same event id
-- must never be able to credit balance twice.
create table if not exists processed_stripe_events (
  stripe_event_id text primary key,
  processed_at timestamptz not null default now()
);

-- The *only* sanctioned way `balance` ever changes. Runs as a single atomic
-- statement (so two simultaneous requests can't both read balance=10, both
-- decide "yes I can afford this £10 event", and both succeed - a classic
-- double-spend race condition), and writes the ledger row in the same
-- transaction so balance and wallet_transactions can never drift apart.
create or replace function adjust_user_balance(
  p_user_id uuid,
  p_amount numeric,
  p_type text,
  p_reference_id uuid default null,
  p_stripe_session_id text default null,
  p_stripe_payment_intent_id text default null,
  p_note text default null,
  p_created_by text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance numeric;
begin
  update users
     set balance = balance + p_amount
   where id = p_user_id
   returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'User % not found', p_user_id;
  end if;

  -- Belt-and-braces: the CHECK constraint on users.balance would catch this
  -- too, but raising here gives callers a clearer error message than a raw
  -- constraint-violation would.
  if v_new_balance < 0 then
    raise exception 'Insufficient balance';
  end if;

  insert into wallet_transactions (
    user_id, amount, balance_after, type, reference_id,
    stripe_session_id, stripe_payment_intent_id, note, created_by
  ) values (
    p_user_id, p_amount, v_new_balance, p_type, p_reference_id,
    p_stripe_session_id, p_stripe_payment_intent_id, p_note, p_created_by
  );

  return v_new_balance;
end;
$$;

-- Nobody calls this directly except the Edge Functions, which connect using
-- the service_role key (which isn't affected by REVOKE - it bypasses grants
-- and RLS entirely, by design). This line stops it being reachable at all
-- via the browser's anon/authenticated Supabase session, even indirectly
-- through supabase-js's `.rpc()`.
revoke all on function adjust_user_balance(uuid, numeric, text, uuid, text, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) Row Level Security for the two brand-new tables above.
-- ----------------------------------------------------------------------------
-- Nothing else in this app uses RLS (every other table relies on the anon
-- key having full table-level access, with no policies at all) - we're
-- deliberately not changing that broader pattern here, since retrofitting
-- RLS across the whole schema is a much bigger project. These two tables
-- are new, so enabling RLS on them can't break anything that already works.
alter table wallet_transactions enable row level security;
drop policy if exists wallet_transactions_select_own on wallet_transactions;
create policy wallet_transactions_select_own on wallet_transactions for select
  using (user_id in (select id from users where auth_user_id = auth.uid()));
-- No insert/update/delete policy for anon/authenticated - only the
-- service_role key (used inside adjust_user_balance()'s callers) can write.

alter table processed_stripe_events enable row level security;
-- Intentionally no policies at all: only the service_role key (used by the
-- stripe-webhook function) ever touches this table.

-- ----------------------------------------------------------------------------
-- 4) Lock down the columns that represent real money or verified
--    membership/payment state, so the browser can never write to them
--    directly - only Edge Functions (service_role) can, after checking
--    identity and doing the real math server-side.
-- ----------------------------------------------------------------------------
-- Without this, a wallet is a two-minute exploit: anyone can open dev tools
-- and PATCH their own balance to any number they like, since every other
-- table/column in this schema is currently wide open to the anon key.
revoke update (
  balance,
  auth_user_id,
  role,
  membership_status,
  membership_start_date,
  membership_end_date,
  membership_duration_weeks,
  membership_requested_duration_weeks
) on users from anon, authenticated;

-- `payment_status` on signups/merchandise_orders used to be set by a
-- client-side "I've Paid" self-report (see the now-removed markSignupPaid()/
-- confirmMerchandiseOrderPaymentMade() pattern). Now that paying = an
-- instant, verified balance debit, only the spend-balance Edge Function
-- should ever set these.
revoke update (payment_status) on signups from anon, authenticated;
revoke update (payment_status) on merchandise_orders from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) Housekeeping / notes
-- ----------------------------------------------------------------------------
-- The old `password_hash`, `reset_token`, and `reset_token_expiry` columns on
-- `users` are no longer read or written by the app after this migration -
-- login/registration/password-reset now go through Supabase Auth instead.
-- They're deliberately left in place (not dropped) so nothing is destroyed
-- while you verify the migration went smoothly; drop them later if you want:
--   alter table users drop column password_hash;
--   alter table users drop column reset_token;
--   alter table users drop column reset_token_expiry;
--
-- `membership_payment_ref` is likewise no longer written going forward (the
-- old bank-transfer self-report flow it supported has been replaced by
-- instant balance-based payment) - left in place purely as a historical
-- record of past bank-transfer references.
