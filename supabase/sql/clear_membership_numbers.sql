-- ============================================================================
-- ONE-OFF: CLEAR ALL MEMBERSHIP NUMBERS (for manual re-entry)
-- ============================================================================
-- Run this in the Supabase SQL Editor.
--
-- Why: every existing membership_number was assigned by the old, buggy logic
-- that fired the moment an admin approved a registration - not when someone
-- actually paid for/held a real membership. That's now fixed going forward
-- (see assignNextMembershipNumberIfNeeded() in supabase/functions/
-- spend-balance/index.ts and supabase/functions/admin-actions/index.ts - only
-- assigns a number once membership_status actually goes 'Active'), but it
-- doesn't clean up numbers that were already wrongly assigned before that
-- fix. Rather than try to auto-detect who "really" qualifies (which is what
-- an earlier version of this script attempted, and which itself produced
-- wrong results for some accounts), this just wipes the column completely so
-- you can re-enter each real member's correct number by hand via Admin ->
-- Manage Players -> click a player -> Membership Number.
--
-- --------------------------------------------------------------------------
-- STEP 0 (optional): see exactly what's about to be cleared before you clear
-- it, in case you want to note any numbers down first.
-- --------------------------------------------------------------------------
select username, first_name, surname, membership_number, membership_status,
       membership_start_date, membership_end_date, created_at
from users
where membership_number is not null
order by membership_number asc;

-- --------------------------------------------------------------------------
-- STEP 1: clear every membership number.
-- --------------------------------------------------------------------------
update users set membership_number = null;

-- --------------------------------------------------------------------------
-- STEP 2 (optional): a ready-made list of everyone who currently has a real,
-- active or past membership (i.e. an actual membership_start_date on file),
-- ordered by when that membership started - a reasonable order to work
-- through while re-entering numbers by hand. Anyone with no start date here
-- has never actually paid for/held a membership and shouldn't get a number.
-- --------------------------------------------------------------------------
select username, first_name, surname, membership_status,
       membership_start_date, membership_end_date, created_at
from users
where membership_start_date is not null
order by membership_start_date asc;
