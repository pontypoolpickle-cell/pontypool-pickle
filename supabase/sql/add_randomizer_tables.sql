-- ============================================================================
-- THE RANDOMIZER (item #5)
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (uses "if not exists").
--
-- "The Randomizer" is a new event type: an admin flags an event as a
-- Randomizer (must have a player count that's a multiple of 4), and once
-- it's actually started from that event (see randomizer_session.event_id
-- below), a nav link appears for everyone to open the live Randomizer page.
-- Each round randomly mixes everyone onto fresh 4-player courts (2v2) -
-- there's no rating-based promotion/demotion like the Ladders feature.
-- Scores can be entered by anyone logged in, but only admins can edit a
-- score that's already been entered (see public/index.html for the
-- enforcement, there being no RLS on this schema - same posture as every
-- other table here).
--
-- IMPORTANT: none of this is permanent match history and none of it ever
-- touches anyone's rating - randomizer_session/randomizer_games are purely
-- scratch storage for the duration of one live tournament, and are deleted
-- outright once the event is ended (see finalizeRandomizerEvent() in
-- public/index.html). The only thing kept forever is the top-3 male/top-3
-- female result, copied into hall_of_fame below right before the live rows
-- are deleted - ready for a future "Hall of Fame" page, not used anywhere
-- yet.
-- ============================================================================

-- Event flag (item #5) - "The Randomizer" event type. Enforced in the app
-- (not the database) that max_players is a multiple of 4 whenever this is
-- checked - see submitNewEvent() in public/index.html.
alter table events add column if not exists is_randomizer boolean default false;

-- One row per currently-live Randomizer tournament. `status` is 'Active'
-- while in progress; the row (and all its randomizer_games rows) is deleted
-- once the event is ended, right after the final standings are copied into
-- hall_of_fame - so in steady state this table is normally empty.
create table if not exists randomizer_session (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id),
  name text not null,
  status text not null default 'Active',
  current_round integer not null default 1,
  -- The full list of participating player names, fixed for the whole
  -- tournament (every round reshuffles this same list onto fresh courts -
  -- nobody is added/removed round to round). See startRandomizerSession()/
  -- randomizeNextRound() in public/index.html.
  players jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- One row per 4-player court game, one round at a time. p1+p2 are "Team A",
-- p3+p4 are "Team B" - purely for who's grouped with who on a court, there's
-- no persistent "team" concept across rounds (every round is freshly
-- randomized from scratch). score_a/score_b/scored_at are null until
-- someone enters that court's result.
create table if not exists randomizer_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references randomizer_session(id) on delete cascade,
  round integer not null,
  court integer not null,
  p1 text not null,
  p2 text not null,
  p3 text not null,
  p4 text not null,
  score_a integer,
  score_b integer,
  scored_at timestamptz,
  scored_by text,
  created_at timestamptz not null default now()
);

create index if not exists randomizer_games_session_round_idx on randomizer_games (session_id, round);

-- No RLS on either of the two tables above - same "no RLS, client code is
-- the boundary" posture as every other table in this schema (see the note
-- near the top of this file). Explicitly disabled here as a safety net:
-- if a table gets created via the Supabase Table Editor UI instead of
-- pasted into the SQL Editor, "Enable Row Level Security" defaults to ON
-- there and silently blocks every insert/update with no policies defined,
-- throwing "new row violates row-level security policy".
alter table randomizer_session disable row level security;
alter table randomizer_games disable row level security;

-- Permanent record of the top 3 male / top 3 female finishers of every
-- Randomizer tournament ever run (by total points scored, then wins) -
-- written once, right when an admin ends the event (see
-- finalizeRandomizerEvent()). Not displayed anywhere yet - this is laying
-- the groundwork for a future "Hall of Fame" page, as requested.
create table if not exists hall_of_fame (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id),
  event_title text,
  event_date date,
  category text not null, -- 'Male' or 'Female'
  position integer not null, -- 1, 2 or 3
  player_name text not null,
  total_points integer not null default 0,
  wins integer not null default 0,
  created_at timestamptz not null default now()
);

-- See the note above randomizer_session for why this is explicit.
alter table hall_of_fame disable row level security;
