-- ============================================================================
-- ADD USER PROFILE BIO + AVATAR COLUMNS (expanded personal profile / Profile tab)
-- ============================================================================
-- Run this once in the Supabase SQL Editor if it hasn't been run already.
-- Safe to re-run (uses "if not exists").
--
-- What these are for: the new "Profile" tab (shown to any logged-in player)
-- lets them write a short bio and upload their own profile picture, alongside
-- the existing match/winstreak/best-partner stats. See renderProfilePage()/
-- saveOwnBio()/handleOwnAvatarUpload() in public/index.html.
--
-- The picture itself is uploaded to the same public "event-documents"
-- Storage bucket already used for Rules PDFs / merchandise / gallery photos
-- (just a new "avatars/" path prefix) - no extra bucket needs creating or
-- any new Storage policy, as long as that bucket's existing public-read /
-- anyone-can-upload policies (see the setup comment near the top of
-- public/index.html) are already in place.
--
-- Like every other non-money/membership column on `users`, these are left
-- writable by the anon/authenticated key (they're not in the `revoke update
-- (...)` list in wallet_stripe_auth_migration.sql) - the app only ever
-- writes to the current user's own row (`.eq('username',
-- currentUser.username)`), consistent with this schema's existing "no RLS,
-- client code is the boundary" posture everywhere outside the wallet/
-- membership columns.
-- ============================================================================

alter table users add column if not exists bio text;
alter table users add column if not exists avatar_url text;
