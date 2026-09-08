-- ============================================================================
-- TRIM STRAY WHITESPACE FROM NAME (AND NAME-LIKE) FIELDS
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run at any time - every
-- UPDATE below only touches rows that actually have leading/trailing
-- whitespace, so running it again once everything's already clean is a no-op.
--
-- Why this matters beyond just tidiness: a lot of this app matches player
-- names *exactly* between tables - e.g. ladder_courts.player_name against
-- ladder_games.p1/p2/p3/p4 (see updateLadderScore()/recalculateLadderCourtStandings()
-- in public/index.html), or matches.w1/w2/l1/l2 against players.name when
-- recalculating Elo. A single trailing space that snuck in from a copy-paste
-- or a stray keystroke on one side of one of those comparisons is enough to
-- silently break that match - which is exactly the kind of bug that caused a
-- player's ladder points to go missing. Trimming every name-like column once
-- (and see the note at the bottom about trimming going forward) removes that
-- whole class of problem.
--
-- Scope: every text column that holds a *person's* name (first/last name,
-- a "player_name" snapshot, a username, or an admin's name recorded on an
-- action) across the schema. Non-personal names (event titles, merchandise
-- item names, gallery captions, location names, etc.) are deliberately left
-- alone here since nothing matches on them exactly the way player names are.
--
-- This trims BOTH leading and trailing whitespace (not just trailing) -
-- leading spaces cause exactly the same silent-mismatch problem, so there's
-- no reason to fix one and not the other while we're in here. It does NOT
-- collapse repeated internal whitespace (e.g. "John  Smith" -> "John Smith")
-- - see the optional, commented-out section near the bottom if you'd also
-- like that (it mirrors what normalizeName() already does client-side).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- STEP 0 (optional): preview every row that's about to change, and on which
-- column, before actually running the updates below. Safe to run on its own
-- - it's read-only.
-- ----------------------------------------------------------------------------
select 'users.first_name' as table_column, id::text as row_id, first_name as current_value, trim(first_name) as new_value from users where first_name <> trim(first_name)
union all
select 'users.surname', id::text, surname, trim(surname) from users where surname <> trim(surname)
union all
select 'users.username', id::text, username, trim(username) from users where username <> trim(username)
union all
select 'users.email', id::text, email, trim(email) from users where email is not null and email <> trim(email)
union all
select 'users.consent_verified_by', id::text, consent_verified_by, trim(consent_verified_by) from users where consent_verified_by is not null and consent_verified_by <> trim(consent_verified_by)
union all
select 'players.name', id::text, name, trim(name) from players where name <> trim(name)
union all
select 'matches.w1', id::text, w1, trim(w1) from matches where w1 <> trim(w1)
union all
select 'matches.w2', id::text, w2, trim(w2) from matches where w2 <> trim(w2)
union all
select 'matches.l1', id::text, l1, trim(l1) from matches where l1 <> trim(l1)
union all
select 'matches.l2', id::text, l2, trim(l2) from matches where l2 <> trim(l2)
union all
select 'signups.player_name', id::text, player_name, trim(player_name) from signups where player_name <> trim(player_name)
union all
select 'finance_transactions.player_name', id::text, player_name, trim(player_name) from finance_transactions where player_name is not null and player_name <> trim(player_name)
union all
select 'finance_transactions.added_by', id::text, added_by, trim(added_by) from finance_transactions where added_by is not null and added_by <> trim(added_by)
union all
select 'finance_transactions.voided_by', id::text, voided_by, trim(voided_by) from finance_transactions where voided_by is not null and voided_by <> trim(voided_by)
union all
select 'merchandise_orders.player_name', id::text, player_name, trim(player_name) from merchandise_orders where player_name <> trim(player_name)
union all
select 'merchandise_orders.username', id::text, username, trim(username) from merchandise_orders where username <> trim(username)
union all
select 'merchandise_orders.initials', id::text, initials, trim(initials) from merchandise_orders where initials is not null and initials <> trim(initials)
union all
select 'ladder_courts.player_name', id::text, player_name, trim(player_name) from ladder_courts where player_name is not null and player_name <> trim(player_name)
union all
select 'ladder_games.p1', id::text, p1, trim(p1) from ladder_games where p1 is not null and p1 <> trim(p1)
union all
select 'ladder_games.p2', id::text, p2, trim(p2) from ladder_games where p2 is not null and p2 <> trim(p2)
union all
select 'ladder_games.p3', id::text, p3, trim(p3) from ladder_games where p3 is not null and p3 <> trim(p3)
union all
select 'ladder_games.p4', id::text, p4, trim(p4) from ladder_games where p4 is not null and p4 <> trim(p4)
union all
select 'ladder_games.p1_original', id::text, p1_original, trim(p1_original) from ladder_games where p1_original is not null and p1_original <> trim(p1_original)
union all
select 'ladder_games.p2_original', id::text, p2_original, trim(p2_original) from ladder_games where p2_original is not null and p2_original <> trim(p2_original)
union all
select 'ladder_games.p3_original', id::text, p3_original, trim(p3_original) from ladder_games where p3_original is not null and p3_original <> trim(p3_original)
union all
select 'ladder_games.p4_original', id::text, p4_original, trim(p4_original) from ladder_games where p4_original is not null and p4_original <> trim(p4_original)
union all
select 'live_scramble.p1', id::text, p1, trim(p1) from live_scramble where p1 is not null and p1 <> trim(p1)
union all
select 'live_scramble.p2', id::text, p2, trim(p2) from live_scramble where p2 is not null and p2 <> trim(p2)
union all
select 'live_scramble.p3', id::text, p3, trim(p3) from live_scramble where p3 is not null and p3 <> trim(p3)
union all
select 'live_scramble.p4', id::text, p4, trim(p4) from live_scramble where p4 is not null and p4 <> trim(p4)
union all
select 'wallet_transactions.created_by', id::text, created_by, trim(created_by) from wallet_transactions where created_by is not null and created_by <> trim(created_by)
order by table_column, row_id;

-- ----------------------------------------------------------------------------
-- STEP 1: users - first_name/surname (the original ask), plus username and
-- email, which the login/lookup flow and membership emails also rely on
-- matching/using exactly.
-- ----------------------------------------------------------------------------
update users set first_name = trim(first_name) where first_name <> trim(first_name);
update users set surname = trim(surname) where surname <> trim(surname);
update users set username = trim(username) where username <> trim(username);
update users set email = trim(email) where email is not null and email <> trim(email);
update users set consent_verified_by = trim(consent_verified_by) where consent_verified_by is not null and consent_verified_by <> trim(consent_verified_by);

-- ----------------------------------------------------------------------------
-- STEP 2: players - the master standings/leaderboard table. Every other
-- table below is ultimately matched against (or displayed alongside) this
-- one, so it's the most important table to keep clean.
-- ----------------------------------------------------------------------------
update players set name = trim(name) where name <> trim(name);

-- ----------------------------------------------------------------------------
-- STEP 3: matches - match history, whose w1/w2/l1/l2 columns are matched
-- exactly against players.name whenever Elo is recalculated from scratch
-- (see recalculateAllEloFromScratch()).
-- ----------------------------------------------------------------------------
update matches set w1 = trim(w1) where w1 <> trim(w1);
update matches set w2 = trim(w2) where w2 <> trim(w2);
update matches set l1 = trim(l1) where l1 <> trim(l1);
update matches set l2 = trim(l2) where l2 <> trim(l2);

-- ----------------------------------------------------------------------------
-- STEP 4: signups, finance_transactions, merchandise_orders - player_name
-- (and admin "who did this" fields) snapshotted at the time of the action.
-- ----------------------------------------------------------------------------
update signups set player_name = trim(player_name) where player_name <> trim(player_name);

update finance_transactions set player_name = trim(player_name) where player_name is not null and player_name <> trim(player_name);
update finance_transactions set added_by = trim(added_by) where added_by is not null and added_by <> trim(added_by);
update finance_transactions set voided_by = trim(voided_by) where voided_by is not null and voided_by <> trim(voided_by);

update merchandise_orders set player_name = trim(player_name) where player_name <> trim(player_name);
update merchandise_orders set username = trim(username) where username <> trim(username);
update merchandise_orders set initials = trim(initials) where initials is not null and initials <> trim(initials);

-- ----------------------------------------------------------------------------
-- STEP 5: ladder_courts / ladder_games / live_scramble - the tables directly
-- involved in the round-points bug fixed alongside this script. Cleaning
-- these up now, on top of the code fix, clears out any bad data that's
-- already in there from before the fix.
-- ----------------------------------------------------------------------------
update ladder_courts set player_name = trim(player_name) where player_name is not null and player_name <> trim(player_name);

update ladder_games set p1 = trim(p1) where p1 is not null and p1 <> trim(p1);
update ladder_games set p2 = trim(p2) where p2 is not null and p2 <> trim(p2);
update ladder_games set p3 = trim(p3) where p3 is not null and p3 <> trim(p3);
update ladder_games set p4 = trim(p4) where p4 is not null and p4 <> trim(p4);
update ladder_games set p1_original = trim(p1_original) where p1_original is not null and p1_original <> trim(p1_original);
update ladder_games set p2_original = trim(p2_original) where p2_original is not null and p2_original <> trim(p2_original);
update ladder_games set p3_original = trim(p3_original) where p3_original is not null and p3_original <> trim(p3_original);
update ladder_games set p4_original = trim(p4_original) where p4_original is not null and p4_original <> trim(p4_original);

update live_scramble set p1 = trim(p1) where p1 is not null and p1 <> trim(p1);
update live_scramble set p2 = trim(p2) where p2 is not null and p2 <> trim(p2);
update live_scramble set p3 = trim(p3) where p3 is not null and p3 <> trim(p3);
update live_scramble set p4 = trim(p4) where p4 is not null and p4 <> trim(p4);

-- ----------------------------------------------------------------------------
-- STEP 6: wallet_transactions - the admin username recorded against a manual
-- balance adjustment.
-- ----------------------------------------------------------------------------
update wallet_transactions set created_by = trim(created_by) where created_by is not null and created_by <> trim(created_by);

commit;

-- ----------------------------------------------------------------------------
-- NOT covered here, on purpose:
--
-- * ladder_session.players (jsonb) - a nested array-of-arrays of names
--   snapshotted once when a ladder session starts. It's write-only bookkeeping
--   (nothing in the app currently reads it back for display or matching -
--   ladder_courts.player_name, already covered above, is what the live UI and
--   scoring actually use), so it's lower value and the jsonb array surgery
--   needed to trim inside it isn't worth the added complexity unless you find
--   a concrete reason to also want it clean. Ask if you'd like that added.
--
-- * Non-personal names (events.title, merchandise_items.name, locations.name,
--   gallery_photos.caption, etc.) - nothing in the app matches these
--   *exactly* against another table the way player names are, so stray
--   whitespace there is a cosmetic issue rather than a correctness one.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- OPTIONAL: also collapse repeated internal whitespace (e.g. a name typed as
-- "John  Smith" with two spaces) down to a single space, matching what
-- normalizeName() already does client-side for comparisons. Uncomment and
-- run if you want this too - each line below is the same column already
-- handled above, just with regexp_replace(..., '\s+', ' ', 'g') added on top
-- of trim().
-- ----------------------------------------------------------------------------
-- update users set first_name = regexp_replace(trim(first_name), '\s+', ' ', 'g');
-- update users set surname = regexp_replace(trim(surname), '\s+', ' ', 'g');
-- update players set name = regexp_replace(trim(name), '\s+', ' ', 'g');
-- update matches set w1 = regexp_replace(trim(w1), '\s+', ' ', 'g'), w2 = regexp_replace(trim(w2), '\s+', ' ', 'g'), l1 = regexp_replace(trim(l1), '\s+', ' ', 'g'), l2 = regexp_replace(trim(l2), '\s+', ' ', 'g');
-- update signups set player_name = regexp_replace(trim(player_name), '\s+', ' ', 'g');
-- update ladder_courts set player_name = regexp_replace(trim(player_name), '\s+', ' ', 'g') where player_name is not null;
