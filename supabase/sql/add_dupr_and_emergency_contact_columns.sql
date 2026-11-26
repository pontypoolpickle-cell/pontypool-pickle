-- ============================================================================
-- ADD DUPR NUMBER + EMERGENCY CONTACT COLUMNS
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (uses "if not exists").
--
-- DUPR membership number (item #2) - optional, self-entered from the
-- "Profile" tab, with a public/private toggle: shown on a player's profile
-- only when dupr_public is true, except to admins who can always see it
-- regardless of the toggle. See saveOwnDupr()/buildProfileView()/
-- openAdminPlayerProfile() in public/index.html.
alter table users add column if not exists dupr_number text;
alter table users add column if not exists dupr_public boolean not null default false;

-- Emergency contact info (items #3 & #4) - mandatory at sign up (see
-- processSignup()/registerUser()), and editable any time afterwards from the
-- Profile tab (see saveOwnEmergencyContact()). Deliberately left OUT of the
-- broad `members` list fetch every visitor's browser loads for the public
-- leaderboard (same reasoning as wallet `balance`) - it's only ever fetched
-- on demand, either for the logged-in player's own record
-- (fetchOwnEmergencyContact()) or by an admin viewing a specific player's
-- profile (openAdminPlayerProfile()). Never shown on any public-facing page.
alter table users add column if not exists emergency_contact_name text;
alter table users add column if not exists emergency_contact_phone text;
alter table users add column if not exists emergency_contact_relationship text;
