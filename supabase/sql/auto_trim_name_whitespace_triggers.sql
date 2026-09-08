-- ============================================================================
-- AUTO-TRIM NAME (AND NAME-LIKE) FIELDS GOING FORWARD
-- ============================================================================
-- Run this once in the Supabase SQL Editor. Safe to re-run any time (e.g.
-- after adding a new column, or after running
-- add_ladder_substitute_columns.sql) - it always drops and recreates each
-- trigger from scratch based on whichever of the target columns actually
-- exist on this database right now.
--
-- What this does: installs a BEFORE INSERT OR UPDATE trigger on every table
-- listed below that automatically trims leading/trailing whitespace AND
-- collapses repeated internal whitespace (e.g. "John   Smith" -> "John
-- Smith") on every name-like column, for every row, no matter what actually
-- inserts/updates it - the main app, a future admin tool, an Edge Function,
-- or someone running manual SQL. This is enforced at the database level, so
-- it can't be skipped by a code path that forgets to trim client-side (which
-- is exactly what caused the "logins failing"/"can't sign up to an event"
-- bugs previously fixed in processSignup()/registerUser() - see f7bd948 -
-- and contributed to the ladder round-points bug fixed alongside
-- trim_name_whitespace.sql). From here on, that whole class of bug is closed
-- off for good, regardless of what future code does or doesn't remember to
-- trim on its own.
--
-- This does NOT fix data that's already in the database with bad whitespace
-- - it only normalizes rows as they're written from now on. Run
-- trim_name_whitespace.sql first (once) to clean up existing rows, then this
-- script to stop it recurring.
--
-- Scope is identical to trim_name_whitespace.sql - see that file's header
-- for the full reasoning on which columns are covered and why.
-- ============================================================================

do $$
declare
  targets record;
  tbl text;
  cols text[];
  col text;
  existing_cols text[];
  fn_name text;
  trg_name text;
  body text;
begin
  for targets in
    select * from (values
      ('users', array['first_name','surname','username','email','consent_verified_by']),
      ('players', array['name']),
      ('matches', array['w1','w2','l1','l2']),
      ('signups', array['player_name']),
      ('finance_transactions', array['player_name','added_by','voided_by']),
      ('merchandise_orders', array['player_name','username','initials']),
      ('ladder_courts', array['player_name']),
      ('ladder_games', array['p1','p2','p3','p4','p1_original','p2_original','p3_original','p4_original']),
      ('live_scramble', array['p1','p2','p3','p4']),
      ('wallet_transactions', array['created_by'])
    ) as t(tbl, cols)
  loop
    tbl := targets.tbl;
    cols := targets.cols;

    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = tbl) then
      raise notice '% : table does not exist on this database - skipped', tbl;
      continue;
    end if;

    select array_agg(c order by c) into existing_cols
    from unnest(cols) as c
    where exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = tbl and column_name = c
    );

    if existing_cols is null then
      raise notice '% : none of its target columns exist on this database - skipped', tbl;
      continue;
    end if;

    fn_name := 'trim_whitespace_' || tbl;
    trg_name := 'trim_whitespace_' || tbl || '_trg';

    body := '';
    foreach col in array existing_cols loop
      body := body || format(
        'new.%I := regexp_replace(btrim(new.%I), ''\s+'', '' '', ''g''); ',
        col, col
      );
    end loop;

    execute format(
      'create or replace function %I() returns trigger language plpgsql as $f$ begin %s return new; end; $f$;',
      fn_name, body
    );

    execute format('drop trigger if exists %I on %I;', trg_name, tbl);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function %I();',
      trg_name, tbl, fn_name
    );

    raise notice '% : trigger installed, auto-trimming %', tbl, existing_cols;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verify what's installed - lists every trigger this script just created.
-- ----------------------------------------------------------------------------
select event_object_table as table_name, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_name like 'trim_whitespace_%_trg'
order by 1, 4;

-- ----------------------------------------------------------------------------
-- To remove these triggers later, for any table:
--   drop trigger if exists trim_whitespace_<table>_trg on <table>;
--   drop function if exists trim_whitespace_<table>();
-- ----------------------------------------------------------------------------
