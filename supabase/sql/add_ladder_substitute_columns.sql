-- ============================================================================
-- ADD LADDER SUBSTITUTION TRACKING COLUMNS (p1_original/p2_original/p3_original/p4_original)
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (uses "if not exists").
--
-- What these columns are for: the ladder's "Substitute a Player" feature
-- (the button shown on each not-yet-scored game card) lets an admin swap one
-- player out of a single game - e.g. someone gets tired or has to leave
-- early - without disrupting the rest of that court/round. Only that one
-- game's line-up changes.
--
-- Elo/match history always credits whoever actually played the game (the
-- substitute), same as normal. But the ORIGINAL player still holds that
-- slot on the ladder for the rest of the round, so their round_points
-- (which decide who gets promoted/relegated at the end of the round - see
-- endLadderRound()/sortLadderCourtStandings() in public/index.html) need to
-- keep tracking THAT SLOT's result, not the substitute's. p{N}_original
-- records who the slot originally belonged to (set automatically, once, the
-- first time that slot is substituted) so
-- recalculateLadderCourtStandings()/updateLadderScore() know who to actually
-- award/deduct ladder points to when that game is scored.
--
-- Without these columns, substituteLadderGamePlayer() - the function behind
-- the "Substitute a Player" button - fails outright as soon as an admin
-- tries to use it (Postgres/PostgREST error: the column doesn't exist), so
-- the feature is effectively broken until this is run.
-- ============================================================================

alter table ladder_games add column if not exists p1_original text;
alter table ladder_games add column if not exists p2_original text;
alter table ladder_games add column if not exists p3_original text;
alter table ladder_games add column if not exists p4_original text;
