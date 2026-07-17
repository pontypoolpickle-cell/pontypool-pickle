# membership-reminders

Scheduled Edge Function (via pg_cron) for the Membership feature. Runs once a
day and:

1. Emails members whose `membership_end_date` is exactly 7 days away
   (`membership_expiry_reminder`-style email), and stamps
   `membership_last_reminder_sent` so it's never sent twice.
2. Auto-expires any membership whose `membership_end_date` has already
   passed: `membership_status -> 'Expired'`, `role -> 'Non-Member'` (Admins
   are exempt). This is the authoritative expiry check - the front-end also
   has a same-day safety net on login/every couple of minutes, but this cron
   job is what keeps things accurate even if nobody logs in.

## Deploy

```bash
supabase functions deploy membership-reminders --no-verify-jwt
```

`--no-verify-jwt` is used because this function is invoked by `pg_cron` /
`pg_net`, not by a logged-in browser session, so there's no user JWT to
verify. It still requires the correct `apikey`/`Authorization` header, which
`schedule.sql` sends using the anon key - the function's actual writes use the
service role key (see below) so it can bypass RLS regardless of which key
called it.

## Required secrets

Set these once for the project (they apply to all functions, so you likely
already have them from `send-email`):

```bash
supabase secrets set RESEND_API_KEY=<your resend key>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected into
every Edge Function by the Supabase runtime - no need to set them manually.

## Schedule it

Run `schedule.sql` in this folder (via the Supabase SQL editor) after
deploying, filling in your project ref and anon key.
