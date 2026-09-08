-- ============================================================================
-- TRIM STRAY WHITESPACE FROM NAME (AND NAME-LIKE) FIELDS
-- ============================================================================
-- Run this in the Supabase SQL Editor. Safe to re-run at any time - every
-- column is only ever updated where it actually has leading/trailing
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
-- removes that whole class of problem.
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
-- - see the optional, commented-out block near the bottom if you'd also like
-- that (it mirrors what normalizeName() already does client-side).
--
-- Column-existence safe: a few of the columns below (e.g.
-- ladder_games.p1_original, added by a later feature) were introduced via an
-- `alter table ... add column if not exists ...` patch in public/index.html
-- rather than the table's original `create table`, so they may not exist yet
-- on every database depending on which patches have actually been applied
-- (and wallet_transactions may not exist at all if the wallet/Stripe feature
-- hasn't been set up). Rather than hard-coding column references that would
-- error out with something like:
--   ERROR: column "p1_original" does not exist
-- on a database that's missing one of them, every table/column pair below is
-- checked against information_schema first and simply skipped (with a
-- NOTICE) if it isn't there yet - the rest of the script still runs.
-- ============================================================================

do $$
declare
  -- Each row is [table_name, column_name]. Add more pairs here if you want
  -- to cover additional name-like columns later.
  targets text[][] := array[
    ['users', 'first_name'],
    ['users', 'surname'],
    ['users', 'username'],
    ['users', 'email'],
    ['users', 'consent_verified_by'],
    ['players', 'name'],
    ['matches', 'w1'],
    ['matches', 'w2'],
    ['matches', 'l1'],
    ['matches', 'l2'],
    ['signups', 'player_name'],
    ['finance_transactions', 'player_name'],
    ['finance_transactions', 'added_by'],
    ['finance_transactions', 'voided_by'],
    ['merchandise_orders', 'player_name'],
    ['merchandise_orders', 'username'],
    ['merchandise_orders', 'initials'],
    ['ladder_courts', 'player_name'],
    ['ladder_games', 'p1'],
    ['ladder_games', 'p2'],
    ['ladder_games', 'p3'],
    ['ladder_games', 'p4'],
    ['ladder_games', 'p1_original'],
    ['ladder_games', 'p2_original'],
    ['ladder_games', 'p3_original'],
    ['ladder_games', 'p4_original'],
    ['live_scramble', 'p1'],
    ['live_scramble', 'p2'],
    ['live_scramble', 'p3'],
    ['live_scramble', 'p4'],
    ['wallet_transactions', 'created_by']
  ];
  pair text[];
  tbl text;
  col text;
  affected int;
begin
  -- Report of every row changed, kept around after this block finishes so
  -- the final SELECT below can show it (temp tables live for the rest of the
  -- session/transaction, not just inside this DO block).
  create temporary table if not exists _trim_report (
    table_column text,
    row_id text,
    old_value text,
    new_value text
  ) on commit preserve rows;

  foreach pair slice 1 in array targets
  loop
    tbl := pair[1];
    col := pair[2];

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = tbl and column_name = col
    ) then
      execute format(
        'insert into _trim_report select %L, id::text, %I, trim(%I) from %I where %I is not null and %I <> trim(%I)',
        tbl || '.' || col, col, col, tbl, col, col, col
      );

      execute format(
        'update %I set %I = trim(%I) where %I is not null and %I <> trim(%I)',
        tbl, col, col, col, col, col
      );
      get diagnostics affected = row_count;
      if affected > 0 then
        raise notice '%.%: trimmed % row(s)', tbl, col, affected;
      end if;
    else
      raise notice '%.% does not exist on this database - skipped', tbl, col;
    end if;
  end loop;
end $$;

-- Full before/after report of every row that was changed by the block above.
select * from _trim_report order by table_column, row_id;

drop table if exists _trim_report;

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
-- run this whole block if you want that too - it's the same column-existence
-- safe pattern as above, just with regexp_replace(..., '\s+', ' ', 'g') added
-- on top of trim().
-- ----------------------------------------------------------------------------
-- do $$
-- declare
--   targets text[][] := array[
--     ['users', 'first_name'], ['users', 'surname'], ['users', 'username'],
--     ['players', 'name'],
--     ['matches', 'w1'], ['matches', 'w2'], ['matches', 'l1'], ['matches', 'l2'],
--     ['signups', 'player_name'],
--     ['finance_transactions', 'player_name'], ['finance_transactions', 'added_by'], ['finance_transactions', 'voided_by'],
--     ['merchandise_orders', 'player_name'], ['merchandise_orders', 'username'], ['merchandise_orders', 'initials'],
--     ['ladder_courts', 'player_name'],
--     ['ladder_games', 'p1'], ['ladder_games', 'p2'], ['ladder_games', 'p3'], ['ladder_games', 'p4'],
--     ['ladder_games', 'p1_original'], ['ladder_games', 'p2_original'], ['ladder_games', 'p3_original'], ['ladder_games', 'p4_original'],
--     ['live_scramble', 'p1'], ['live_scramble', 'p2'], ['live_scramble', 'p3'], ['live_scramble', 'p4'],
--     ['wallet_transactions', 'created_by']
--   ];
--   pair text[];
--   tbl text;
--   col text;
-- begin
--   foreach pair slice 1 in array targets
--   loop
--     tbl := pair[1];
--     col := pair[2];
--     if exists (
--       select 1 from information_schema.columns
--       where table_schema = 'public' and table_name = tbl and column_name = col
--     ) then
--       execute format(
--         'update %I set %I = regexp_replace(trim(%I), ''\s+'', '' '', ''g'') where %I is not null',
--         tbl, col, col, col
--       );
--     end if;
--   end loop;
-- end $$;
