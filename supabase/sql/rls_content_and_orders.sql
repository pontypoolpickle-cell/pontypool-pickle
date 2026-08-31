-- ============================================================================
-- RLS FOR THE 7 "UNRESTRICTED" TABLES (faqs, finance_transactions,
-- gallery_photos, merchandise_items, merchandise_orders, merchandise_sizes,
-- site_settings)
-- ============================================================================
-- Run this once in the Supabase SQL Editor, same way as
-- wallet_stripe_auth_migration.sql. Safe to re-run.
--
-- Why these 7 specifically show "Unrestricted" and the others don't: these
-- are the tables added by later feature work that never got the same RLS
-- treatment the original tables apparently received early on. This migration
-- catches them up.
--
-- Most of these are low-stakes (FAQ text, gallery photos, a settings
-- key/value store) - fixed here mainly to clear the warning honestly rather
-- than paper over it, since the fix is nearly free (public read, admin-only
-- write, no behaviour change for anyone using the app normally).
--
-- merchandise_orders is the one that actually matters: without protection,
-- anyone could create (or edit) an order with a fabricated total_price and
-- then pay that fake amount via spend-balance, which trusts whatever price
-- is already sitting on the order row. The fix below makes the database
-- itself verify, at the moment an order is created, that its price actually
-- matches the current catalog price for that item/size - not just a client-
-- side check that a modified request could skip. Once created, only admins
-- can change an order at all, so the verified price can't be edited
-- afterwards either.
--
-- finance_transactions is your internal financial ledger - restricted to
-- admins entirely (nobody else has any reason to read or write it).
--
-- One edge case worth knowing about: faqs/merchandise_items/merchandise_sizes
-- have a "first-run auto-seed" (seedDefaultFaqs()/seedDefaultMerchandise() in
-- index.html) that populates default content the very first time those
-- tables are ever empty - and it can run from any visitor's browser, not
-- just an admin's. Since your site's tables already have real content in
-- them, this will never actually trigger again in practice, so it's not a
-- real-world problem here - just flagging it in case you ever wipe one of
-- these tables and wonder why it doesn't auto-repopulate for a non-admin
-- visitor (an admin loading the page once will still trigger it fine).
-- ============================================================================

-- Reusable admin check - mirrors the same "is this really an admin" logic
-- already used server-side in the admin-actions Edge Function, just
-- expressed as a SQL function so RLS policies can call it directly. Relies
-- on the Supabase Auth migration (auth_user_id) - see
-- wallet_stripe_auth_migration.sql.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from users where auth_user_id = auth.uid() and role = 'Admin'
  );
$$;
grant execute on function is_admin() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Simple content tables: public read, admin-only write. No behaviour change
-- for normal use of the site - members/visitors already only ever read
-- these, and the existing admin panel actions are the only things that write
-- to them, which now works because admins have a real Supabase Auth session
-- (post auth migration) that is_admin() can check.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['faqs', 'gallery_photos', 'site_settings', 'merchandise_items', 'merchandise_sizes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select_all on %I', t, t);
    execute format('create policy %I_select_all on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_admin_insert on %I', t, t);
    execute format('create policy %I_admin_insert on %I for insert with check (is_admin())', t, t);
    execute format('drop policy if exists %I_admin_update on %I', t, t);
    execute format('create policy %I_admin_update on %I for update using (is_admin()) with check (is_admin())', t, t);
    execute format('drop policy if exists %I_admin_delete on %I', t, t);
    execute format('create policy %I_admin_delete on %I for delete using (is_admin())', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- finance_transactions - fully admin-only, no public/member access at all.
-- ----------------------------------------------------------------------------
alter table finance_transactions enable row level security;

drop policy if exists finance_transactions_admin_select on finance_transactions;
create policy finance_transactions_admin_select on finance_transactions for select using (is_admin());

drop policy if exists finance_transactions_admin_insert on finance_transactions;
create policy finance_transactions_admin_insert on finance_transactions for insert with check (is_admin());

drop policy if exists finance_transactions_admin_update on finance_transactions;
create policy finance_transactions_admin_update on finance_transactions for update using (is_admin()) with check (is_admin());

drop policy if exists finance_transactions_admin_delete on finance_transactions;
create policy finance_transactions_admin_delete on finance_transactions for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- merchandise_orders - members can see their own orders (or all of them, if
-- admin); can only create an order as themselves, and only at the real
-- catalog price for the size they picked (the `total_price = (select price
-- ...)` check below - this is what actually stops a tampered/fabricated
-- price from ever landing in the table, regardless of what a modified
-- request sends). Once created, only admins can change or delete an order -
-- payment_status is separately locked at the column level too (see
-- wallet_stripe_auth_migration.sql), so this is defence in depth, not the
-- only thing stopping payment_status specifically from being faked.
-- ----------------------------------------------------------------------------
alter table merchandise_orders enable row level security;

drop policy if exists merchandise_orders_select_own_or_admin on merchandise_orders;
create policy merchandise_orders_select_own_or_admin on merchandise_orders for select
  using (
    is_admin()
    or username = (select username from users where auth_user_id = auth.uid())
  );

drop policy if exists merchandise_orders_insert_own_at_catalog_price on merchandise_orders;
create policy merchandise_orders_insert_own_at_catalog_price on merchandise_orders for insert
  with check (
    username = (select username from users where auth_user_id = auth.uid())
    and total_price = (select price from merchandise_sizes where id = size_id)
  );

drop policy if exists merchandise_orders_admin_update on merchandise_orders;
create policy merchandise_orders_admin_update on merchandise_orders for update using (is_admin()) with check (is_admin());

drop policy if exists merchandise_orders_admin_delete on merchandise_orders;
create policy merchandise_orders_admin_delete on merchandise_orders for delete using (is_admin());
