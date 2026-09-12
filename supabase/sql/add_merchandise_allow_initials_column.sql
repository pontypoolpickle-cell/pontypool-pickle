-- ============================================================================
-- ADD MERCHANDISE ITEM "ALLOW INITIALS" TOGGLE (merchandise_items.allow_initials)
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (uses "if not exists"/"if exists").
--
-- What this is for: some merchandise items (e.g. items with printed rather
-- than embroidered branding) can't have a member's initials added to them.
-- This column lets an admin toggle, per item, whether the "Your Initials"
-- field is offered to members ordering it at all - see
-- openMerchandiseOrderModal()/placeMerchandiseOrder() (member order flow)
-- and openAddMerchandiseItemModal()/openEditMerchandiseItemModal()/
-- saveMerchandiseItem() (Admin View's Edit Merchandise Item modal) in
-- public/index.html.
--
-- Defaults to true so every existing merchandise item keeps behaving exactly
-- as it did before this column existed (initials offered on every item).
-- Without this column, saving a merchandise item's "Allow Initials" toggle
-- from the Admin View fails with a Postgres/PostgREST "column does not
-- exist" error until this is run.
--
-- If you previously ran an early/unmerged version of this migration that
-- added a column called "initials_allowed" instead, the drop below cleans
-- that up - the live code only ever reads/writes "allow_initials".
-- ============================================================================

alter table merchandise_items drop column if exists initials_allowed;
alter table merchandise_items add column if not exists allow_initials boolean not null default true;
