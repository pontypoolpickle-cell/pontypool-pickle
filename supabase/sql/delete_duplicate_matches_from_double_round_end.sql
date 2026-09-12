-- ============================================================================
-- ONE-OFF: DELETE DUPLICATE `matches` ROWS CREATED BY THE LADDER
-- DOUBLE-ROUND-END RACE CONDITION (11 Sept 2026)
-- ============================================================================
-- Run this in the Supabase SQL Editor.
--
-- Why: endLadderRound() used to have no protection against being run twice
-- for the same round (e.g. two admins tapping "Confirm & End Round" on
-- separate devices at the same moment). When that happened, every scored
-- game in the round got recorded into `matches` TWICE - once per concurrent
-- call - which is also why 10 games instead of 5 showed up on every court
-- for the next round. This is now fixed in the app (see endLadderRound()),
-- but it doesn't clean up the duplicate rows that were already written on
-- 11 Sept 2026.
--
-- IMPORTANT - Elo is NOT fixed by this script alone:
-- Deleting a duplicate `matches` row does not undo the rating change that
-- was already applied to the `players` table when that duplicate was
-- persisted, and - because Elo is order-dependent - any match a player
-- played AFTER a duplicate may itself have used a temporarily-inflated
-- rating as its starting point. The only fully correct fix is to:
--   1. Delete the duplicate rows below FIRST, then
--   2. Use the app's own "Recalculate All ELOs" admin action (Admin ->
--      Ratings page -> "Recalculate All ELOs" button), which replays every
--      remaining match in chronological order and rebuilds every player's
--      elo/wins/losses/total_games/weekly_sum/last_match_date from scratch.
-- Do NOT try to hand-roll the Elo reversal in SQL using change_w1/change_w2/
-- change_l1/change_l2 - it will not correctly account for any later matches
-- that cascaded off the inflated rating.
--
-- --------------------------------------------------------------------------
-- STEP 0: PREVIEW - see exactly which matches from 11 Sept 2026 are
-- duplicated (same date, same two teams, same score) before deleting
-- anything. `copies` should be 2 for a straightforward double-run; if you
-- see 3+ for any group, look more closely before deleting.
-- --------------------------------------------------------------------------
select match_date, is_female_only, w1, w2, l1, l2, score_w, score_l,
       count(*) as copies,
       array_agg(id order by created_at asc) as match_ids_oldest_first
from matches
where match_date = '2026-09-11'
group by match_date, is_female_only, w1, w2, l1, l2, score_w, score_l
having count(*) > 1
order by copies desc;

-- --------------------------------------------------------------------------
-- STEP 1: DELETE the extra copies, keeping the OLDEST row (earliest
-- created_at) in each duplicate group and removing the rest. Only touches
-- rows dated 11 Sept 2026, and only rows that are part of an exact-duplicate
-- group (same teams + same score) - anything unique is left untouched.
-- --------------------------------------------------------------------------
delete from matches
where id in (
  select id
  from (
    select id,
           row_number() over (
             partition by match_date, is_female_only, w1, w2, l1, l2, score_w, score_l
             order by created_at asc, id asc
           ) as rn
    from matches
    where match_date = '2026-09-11'
  ) ranked
  where rn > 1
);

-- --------------------------------------------------------------------------
-- STEP 2 (do this next, in the app - not SQL): open Admin -> Ratings page
-- and click "Recalculate All ELOs" to rebuild every player's rating/wins/
-- losses/total_games from the now-deduplicated match history.
-- --------------------------------------------------------------------------
