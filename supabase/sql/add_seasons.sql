-- ============================================================================
-- SEASONS ("Start New Season" admin action)
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (every statement is "if not exists"/idempotent, and the
-- backfill statements are written to be no-ops on a second run).
--
-- Lets an admin archive the current season's ratings/wins/losses and start
-- everyone fresh at a flat baseline (see SEASON_RESET_ELO/startNewSeason()
-- in public/index.html), WITHOUT losing any match history - every match
-- ever played stays in `matches` forever, just tagged with which season it
-- belongs to. recalculateAllEloFromScratch() only ever replays the currently
-- ACTIVE season's matches (the one row in this table with ended_at = null),
-- so archived seasons can never leak back into anyone's live rating, however
-- many times an admin edits/deletes a match or hits "Recalculate All ELOs".
-- Past seasons' win/loss records stay fully visible on a player's profile
-- (see the "Past Seasons" section in buildProfileView()) and via the season
-- filter on the Match History page - both computed live from the same
-- `matches` rows, nothing is ever deleted or snapshotted separately.
-- ============================================================================

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  started_at timestamptz not null default now(),
  -- null while this is the currently-active season; set the moment an admin
  -- starts the next one (see startNewSeason() in public/index.html). There
  -- should only ever be at most one row with ended_at is null at a time.
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Same "no RLS, client code is the boundary" posture as the rest of this
-- schema - see the note near the top of the main inline schema comment in
-- public/index.html.
alter table seasons disable row level security;

-- Backfill: this table starts out empty on a site that's been running since
-- before Seasons existed, but every match already recorded still needs to
-- belong to a season. Create a "Season 1" row covering all of that
-- pre-existing history (started_at = the earliest match ever recorded, or
-- now() if there's no history yet) and leave it active (ended_at null) -
-- it then behaves exactly like any other season, and gets archived the
-- first time an admin actually clicks "Start New Season".
insert into seasons (name, started_at, ended_at)
select 'Season 1', coalesce((select min(match_date) from matches), now()), null
where not exists (select 1 from seasons);

-- Which season a match belongs to. Backfilled onto every pre-existing match
-- (there's only ever one season at backfill time, so this is unambiguous).
alter table matches add column if not exists season_id uuid references seasons(id);
update matches set season_id = (select id from seasons order by started_at asc limit 1) where season_id is null;
create index if not exists matches_season_id_idx on matches (season_id);

-- Generalises the existing per-player "Reset Rating" admin button (see the
-- rating_reset_at/female_rating_reset_at columns and the comment above them
-- in public/index.html) so recalculateAllEloFromScratch() can snap a
-- player's replayed rating back to WHATEVER value they were actually reset
-- to, instead of always assuming the hardcoded sign-up defaults
-- (NEW_SIGNUP_STARTING_ELO/FEMALE_STARTING_ELO). This is what makes
-- "Start New Season" possible without a second, parallel reset mechanism:
-- starting a new season just sets rating_reset_at/rating_reset_value (and
-- the female equivalents) on every player at once, to "now"/SEASON_RESET_ELO,
-- exactly like resetting one player's rating always has.
alter table players add column if not exists rating_reset_value integer;
alter table players add column if not exists female_rating_reset_value integer;

-- Backfill: anyone already reset via the existing single-player "Reset
-- Rating" button before this column existed was always reset to the
-- hardcoded sign-up defaults (1800 mixed / 1200 Women's Rankings) - never to
-- SEASON_RESET_ELO, which didn't exist yet - so fill in those exact values
-- rather than leaving them null, keeping every pre-existing reset behaving
-- identically to how it always has.
update players set rating_reset_value = 1800 where rating_reset_at is not null and rating_reset_value is null;
update players set female_rating_reset_value = 1200 where female_rating_reset_at is not null and female_rating_reset_value is null;
