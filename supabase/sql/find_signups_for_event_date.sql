-- ============================================================================
-- Find everyone signed up for event(s) on a given date (e.g. to refund them
-- after cancelling the event). Run in the Supabase Dashboard -> SQL Editor.
-- ============================================================================
-- Change the date below to the event's date (event_date is stored as a plain
-- 'YYYY-MM-DD' date, matching what's shown/edited on the Events admin page).

-- 1) Everyone currently signed up (Confirmed / Pending Payment / Reserve) -
--    excludes players who already withdrew (status = 'Withdrawn').
select
  e.title            as event_title,
  e.event_date,
  e.event_time,
  s.player_name,
  s.email,
  s.player_type,
  s.status           as signup_status,
  s.payment_status,
  s.created_at       as signed_up_at
from signups s
join events e on e.id = s.event_id
where e.event_date = '2026-10-23'
  and s.status <> 'Withdrawn'
order by e.title, s.status, s.created_at;

-- 2) Just the players who actually paid and are owed a refund (Confirmed or
--    Pending Payment, with payment_status = 'Paid'), with the exact amount
--    owed based on the event's member/non-member price and each player's
--    rate at the time they signed up.
select
  e.title            as event_title,
  e.event_date,
  s.player_name,
  s.email,
  s.player_type,
  case
    when s.player_type in ('Member', 'Admin') then e.member_price
    else e.non_member_price
  end                as refund_amount
from signups s
join events e on e.id = s.event_id
where e.event_date = '2026-10-23'
  and s.status in ('Confirmed', 'Pending Payment')
  and s.payment_status = 'Paid'
order by s.player_name;

-- Note: if you cancel the event from the Admin panel ("Cancel Event" on the
-- event), everyone who paid is now refunded to their wallet balance and
-- emailed automatically (supabase/functions/cancel-event/index.ts) - you
-- don't need to run query #2 or refund anyone by hand. Query #1 is still
-- useful on its own just to see the attendee list, and query #2 is useful
-- if you ever need to double-check or manually process a refund outside
-- that flow (e.g. for a signup with no matching player account, reported
-- back as `unmatchedRefunds` when you cancel the event).
