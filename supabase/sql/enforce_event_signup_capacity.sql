-- ============================================================================
-- STOP EVENTS FROM GOING OVER CAPACITY (overbooking)
-- ============================================================================
-- Run this once in the Supabase SQL Editor, same way as
-- wallet_stripe_auth_migration.sql / rls_content_and_orders.sql. Safe to
-- re-run (drops and recreates the trigger).
--
-- The bug this closes: whether the "Sign Up" button (which creates a
-- Confirmed/Pending Payment row) or the "Join Reserve List" button shows on an
-- event is decided entirely in the browser, from whatever copy of the signups
-- table it last fetched into `globalData` (see getEventQuickStatus()/
-- openCalendarEventModal() in index.html). There is no live sync of that data
-- - a tab left open since before the event filled up keeps showing "Sign Up"
-- and "N spots available" indefinitely. Nothing on the write path re-checked
-- capacity before this bug fix: signupForEvent() just inserted an unconditional
-- Confirmed/Pending Payment row. The result: a member on a stale tab clicks
-- "Sign Up" on an event that is actually already full, and gets a real
-- Confirmed seat landed on top of everyone already there - the event quietly
-- goes over max_players, which is exactly what an admin seeing more
-- confirmed/reserve signups than a member's stale screen showed looks like.
--
-- index.html now re-checks a fresh count immediately before inserting (see the
-- comment on signupForEvent() for why that alone isn't quite enough - it only
-- narrows the race, it doesn't close it: two people on stale tabs could both
-- pass that check a moment apart, before either one's insert has landed). This
-- trigger is the atomic backstop that actually closes the race, at the one
-- place every write - direct signup, reserve promotion, a future admin tool,
-- anything - has to go through regardless of what any browser believes the
-- count is.
--
-- Only INSERT/UPDATE rows that *hold a spot* (Confirmed or Pending Payment -
-- see holdsSpot() in index.html, item #14) are checked; Reserve/Withdrawn rows
-- never count against capacity and are always allowed. promoteReservesForEvent()
-- already caps itself to the number of free spots before promoting anyone, so
-- it should never actually hit this trigger in practice - it's checked anyway
-- for defence in depth, exactly like the existing merchandise_orders price
-- check in rls_content_and_orders.sql.
-- ============================================================================

create or replace function enforce_event_signup_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_p integer;
  held_count integer;
begin
  if new.status not in ('Confirmed', 'Pending Payment') then
    return new;
  end if;

  -- Serializes concurrent sign-ups for the same event so two people racing
  -- for "the last spot" can't both pass the count check below before either
  -- one's row has actually landed - without this, a plain count-then-insert
  -- (even run from a trigger) is still racy under concurrency.
  perform pg_advisory_xact_lock(hashtextextended(new.event_id::text, 0));

  select max_players into max_p from events where id = new.event_id;
  if max_p is null or max_p <= 0 then
    return new; -- uncapped event - nothing to enforce
  end if;

  select count(*) into held_count
  from signups
  where event_id = new.event_id
    and status in ('Confirmed', 'Pending Payment')
    and id is distinct from new.id; -- exclude this row itself on UPDATE

  if held_count >= max_p then
    raise exception 'EVENT_FULL: this event is already at capacity (max %)', max_p
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_event_signup_capacity on signups;
create trigger trg_enforce_event_signup_capacity
before insert or update on signups
for each row execute function enforce_event_signup_capacity();

-- ----------------------------------------------------------------------------
-- One-off check: find any event that's *already* over capacity from before
-- this trigger existed (this won't retroactively fix existing rows - it only
-- stops new ones). Run this to see if the event from the original report (or
-- any other) needs manual cleanup via the admin "View Signups" panel -
-- demoting the newest/lowest-priority excess Confirmed/Pending Payment rows
-- back to Reserve (and refunding anyone paid, same as a normal cancellation).
-- ----------------------------------------------------------------------------
-- select
--   e.id, e.title, e.event_date, e.max_players,
--   count(*) filter (where s.status in ('Confirmed', 'Pending Payment')) as held_count
-- from events e
-- join signups s on s.event_id = e.id
-- group by e.id, e.title, e.event_date, e.max_players
-- having count(*) filter (where s.status in ('Confirmed', 'Pending Payment')) > e.max_players;
