-- ============================================================================
-- ONE-OFF: RESET & REASSIGN MEMBERSHIP NUMBERS
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor after deploying the code change
-- that stops assigning membership_number at account approval/registration
-- time (see the comment near `alter table users add column if not exists
-- membership_number` in public/index.html, and
-- assignNextMembershipNumberIfNeeded() in supabase/functions/spend-balance/
-- index.ts and supabase/functions/admin-actions/index.ts).
--
-- Why this is needed: every existing account currently has a membership
-- number, because the old code assigned one to *everyone* the moment an
-- admin approved their registration - whether or not they ever went on to
-- pay for/hold a membership. This script wipes all of that out and
-- reassigns numbers, starting back at 1, only to accounts that have actually
-- held a paid (or admin-granted gift) membership, in the order they
-- originally signed up.
--
-- IMPORTANT - READ BEFORE RUNNING:
--   - This is irreversible once committed. Run the PREVIEW query in step 0
--     first and sanity-check the result before running the UPDATE in step 2.
--   - "Qualifying" accounts are anyone who currently either (a) already has
--     a membership_number (this deliberately preserves historical/legacy
--     members who were backfilled manually via Admin -> Manage Players,
--     even if their membership_status field doesn't say "Active" - e.g. a
--     lifetime/honorary member predating the wallet system), or (b) has
--     membership_status of 'Active' or 'Expired' (i.e. has paid for/held a
--     real membership at some point, per the existing, unchanged membership
--     activation logic). Accounts that only ever registered and never paid
--     (membership_status = 'None' and no existing number) get no number.
--   - Ordering is by `users.created_at` (when they originally signed up),
--     per the club's request to preserve seniority order rather than
--     re-ordering by payment date.
--   - After this runs, new memberships continue to get the next sequential
--     number automatically the moment they actually pay (or are gifted a
--     membership by an admin) - this script only fixes up the existing data.
-- ============================================================================

-- --------------------------------------------------------------------------
-- STEP 0 (do this first): preview who will get a number and in what order,
-- WITHOUT changing anything. Check this looks right before continuing.
-- --------------------------------------------------------------------------
select
    row_number() over (order by created_at asc, id asc) as new_membership_number,
    username,
    first_name,
    surname,
    created_at,
    membership_status,
    membership_number as current_membership_number
from users
where membership_number is not null
   or membership_status in ('Active', 'Expired')
order by created_at asc, id asc;

-- --------------------------------------------------------------------------
-- STEP 1 + 2: reset and reassign (run together as one statement/transaction)
-- --------------------------------------------------------------------------
begin;

-- Snapshot exactly who qualifies (and their signup order) before nulling
-- anything out, so step 2 has a stable, race-free list to renumber from.
create temporary table _membership_renumber_qualifying as
select id, created_at
from users
where membership_number is not null
   or membership_status in ('Active', 'Expired');

-- Reset the whole column - clears out every number that was wrongly
-- assigned at registration time instead of at payment time, and frees the
-- unique index so step 2 below can't collide with itself.
update users set membership_number = null;

-- Reassign sequentially, starting back at 1, in original signup order.
with ordered as (
    select id, row_number() over (order by created_at asc, id asc) as rn
    from _membership_renumber_qualifying
)
update users u
set membership_number = ordered.rn
from ordered
where u.id = ordered.id;

drop table _membership_renumber_qualifying;

-- Review the result before committing - if anything looks wrong, run
-- `rollback;` instead of `commit;` below and nothing will be changed.
select username, first_name, surname, created_at, membership_status, membership_number
from users
where membership_number is not null
order by membership_number asc;

commit;
-- (If the review above looked wrong, run `rollback;` INSTEAD of `commit;`
-- while still in the same SQL Editor session/transaction.)
