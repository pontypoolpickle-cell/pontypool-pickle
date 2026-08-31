# Wallet / Stripe / Supabase Auth setup guide

This is the step-by-step walkthrough for turning on the club wallet system:
members top up their balance with a card via Stripe, then spend that balance
instantly on membership, event fees, and merchandise - no more bank
transfers, payment references, or admin review queues for day-to-day
payments.

Follow these steps **in order** - later steps assume earlier ones are done.
Do this on a quiet evening, not mid-event - there's a short window partway
through where password login is being migrated.

## 0. Before you touch anything: clear the membership Requests queue

Log in as an admin, go to **Membership -> Requests**, and Activate or
Decline every pending bank-transfer request you can see. After step 2 below,
that queue's Activate/Decline buttons stop working (by design - see the code
comment on `activateMembership()` in `public/index.html`), because
membership status becomes something only the new Edge Functions are allowed
to write. Any request left pending when you run step 2 will need sorting out
manually (ask the member to re-purchase via their wallet once migrated, and
manually adjust their dates via the new "Adjust Membership" admin control if
you need to backdate anything).

## 1. Create a Stripe account

You said you don't have one yet - here's the short version:

1. Go to [stripe.com](https://stripe.com) and sign up (business name,
   country = United Kingdom, email).
2. You can start building/testing immediately in **Test mode** (toggle top
   right of the Stripe Dashboard) without submitting any business details -
   test mode uses fake card numbers and never touches real money.
3. When you're ready to accept real payments, click **Activate your
   account** in the Dashboard and fill in the club's bank details (for
   payouts), and some basic info about the club (as a not-for-profit sports
   club, "Nonprofit"/"Community organisation" is the closest category -
   Stripe will ask a couple of follow-up questions). This is the only part
   that needs real paperwork; everything else below works the same in test
   and live mode, you just swap which API keys you use.
4. Get your API keys: **Developers -> API keys** in the Dashboard. You'll
   see a **Publishable key** (not used by this app - everything goes through
   Edge Functions instead) and a **Secret key**. Copy the Secret key - while
   testing, use the one starting `sk_test_...`; switch to the `sk_live_...`
   one only once you've activated the account and are ready to take real
   payments.

## 2. Run the SQL migration

Supabase Dashboard -> **SQL Editor** -> New query -> paste the entire
contents of [`supabase/sql/wallet_stripe_auth_migration.sql`](../sql/wallet_stripe_auth_migration.sql)
-> Run.

This adds the `balance` column, the `wallet_transactions` ledger, and locks
down the columns that represent real money/membership state so the browser
can no longer write to them directly (see the comments in that file for
exactly why, and which columns).

## 3. Set the Supabase project secrets

Dashboard -> **Edge Functions -> Manage secrets** (or via the CLI:
`supabase secrets set NAME=value`, one per line, from the project root):

```
STRIPE_SECRET_KEY=sk_test_...          # from step 1 - switch to sk_live_... when you go live
STRIPE_WEBHOOK_SECRET=whsec_...        # from step 5 below - you'll come back and set this
SITE_URL=https://www.pontypoolpickle.com   # your real site URL, no trailing slash
MIGRATION_ADMIN_SECRET=<a random string, e.g. output of `openssl rand -hex 32`>
```

(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
already auto-injected into every Edge Function by Supabase - same as the
existing `send-email`/`membership-reminders` functions.)

## 4. Deploy the Edge Functions

From the project root, with the [Supabase CLI](https://supabase.com/docs/guides/cli)
installed and linked to your project (`supabase link`):

```bash
supabase functions deploy send-email
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy wallet-topup-checkout
supabase functions deploy spend-balance
supabase functions deploy cancel-event-signup
supabase functions deploy admin-actions
supabase functions deploy migrate-users-to-auth --no-verify-jwt
```

(`send-email` already existed - redeploy it because this change added a new
`wallet_topup_receipt` template to it. `membership-reminders` is unaffected -
no need to redeploy it.)

The `--no-verify-jwt` ones are called directly by Stripe or by you manually
(with a shared secret), not by the logged-in browser - see the comment at
the top of each function's `index.ts` for why.

## 5. Create the Stripe webhook endpoint

Stripe Dashboard -> **Developers -> Webhooks -> Add endpoint**:

- **Endpoint URL:** `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
  (find `<your-project-ref>` in the Supabase Dashboard URL, or via
  `SUPABASE_URL`)
- **Events to send:** select `checkout.session.completed` and
  `checkout.session.async_payment_succeeded` (search for "checkout" in the
  event picker)
- Click **Add endpoint**, then open it and copy the **Signing secret**
  (starts `whsec_...`)
- Go back to step 3 and set `STRIPE_WEBHOOK_SECRET` to that value, then
  redeploy: `supabase functions deploy stripe-webhook --no-verify-jwt`

Test mode and live mode each have their **own** webhook endpoint and signing
secret - when you switch `STRIPE_SECRET_KEY` to a live key, come back here
and repeat this step for live mode too (and update `STRIPE_WEBHOOK_SECRET`
again).

## 6. Configure Supabase Auth (login is moving off the old password system)

Dashboard -> **Authentication**:

1. **Providers -> Email**: turn **off** "Confirm email". This app already
   gates login behind admin approval (`status = 'Approved'`) - requiring
   Supabase's own email confirmation *as well* just adds a confusing second
   gate for new signups.
2. **Emails -> SMTP Settings**: turn on "Custom SMTP" and enter your Resend
   credentials (the same account already used for `RESEND_API_KEY` in
   `send-email`/`membership-reminders`) - host `smtp.resend.com`, port `465`,
   username `resend`, password = your Resend API key, sender email
   `noreply@pontypoolpickle.com`. Without this, Supabase's own built-in
   mailer has a very low sending rate limit, nowhere near enough for the
   one-off bulk password migration in step 8.
3. **Emails -> Templates -> Reset Password**: this is what members see when
   they use the site's existing "Forgot Password" flow (it now calls
   Supabase Auth under the hood - the login experience is unchanged). Edit
   the template body so the code is available as `{{ .Token }}` - the
   simplest option is to just include it plainly, e.g.:

   ```html
   <h2>Reset your Pontypool Pickle Club password</h2>
   <p>Your reset code is:</p>
   <h1>{{ .Token }}</h1>
   <p>Enter this code on the website to choose a new password. It expires in 1 hour.</p>
   ```

   (Feel free to restyle this to match the club's branding - it just needs
   to contain `{{ .Token }}` somewhere, since the site's reset flow asks the
   member to type that 6-digit code back in, the same way it always has.)

## 7. Run the one-time password migration

This creates a real Supabase Auth account for every existing member and
emails each of them a password-reset link (via the same Resend-backed
"Forgot Password" mechanism from step 6) - see the comment at the top of
`supabase/functions/migrate-users-to-auth/index.ts` for full details.

Dry run first (changes nothing, just reports who *would* be migrated):

```bash
curl -X POST 'https://<your-project-ref>.supabase.co/functions/v1/migrate-users-to-auth' \
  -H 'Content-Type: application/json' \
  -H 'x-migration-secret: <MIGRATION_ADMIN_SECRET from step 3>' \
  -d '{"dryRun": true}'
```

Then for real:

```bash
curl -X POST 'https://<your-project-ref>.supabase.co/functions/v1/migrate-users-to-auth' \
  -H 'Content-Type: application/json' \
  -H 'x-migration-secret: <MIGRATION_ADMIN_SECRET from step 3>' \
  -d '{"dryRun": false}'
```

For a club-sized member list, this processes **15 people per call** by
default (Edge Functions have an execution time limit, and doing this for
everyone in one request can blow past it). The response includes a
`remainingCount` - if it's above 0, just call the exact same request again
(same body) to do the next batch, and repeat until `remainingCount` is 0.
Pass `{"dryRun": false, "batchSize": 25}` to change the batch size if you
want (max 50).

Post in the club WhatsApp group letting everyone know to expect an email and
to use the **Forgot Password** button on the site if it doesn't arrive - see
the response's `errors` array for anyone who failed (usually a bad/missing
email address, or two accounts sharing the same email - only one of a pair
can succeed) and fix those individually with `{"usernames": ["that_one_person"]}`.

## 8. Test it end-to-end (test mode)

With `STRIPE_SECRET_KEY` still set to a `sk_test_...` key:

1. Log in as a test member (reset your password via step 7's email first).
2. Click the 💰 **Wallet** button in the nav, top up £10.
3. On the Stripe Checkout page, use test card `4242 4242 4242 4242`, any
   future expiry, any CVC. Complete payment.
4. You should land back on the site with a "Payment received" toast, and
   the wallet balance update within a couple of seconds (the Stripe webhook
   has to fire and update the database - refresh if it doesn't update
   immediately).
5. Try buying a membership plan / paying an event fee / paying for a
   merchandise order from that balance, and try cancelling a paid event
   signup both more than 24h and less than 24h before it starts, to confirm
   the refund-vs-no-refund behaviour.

## 9. Go live

1. In the Stripe Dashboard, click **Activate your account** if you haven't
   already (step 1.3).
2. Repeat step 5 for **live mode** (its own webhook endpoint + signing
   secret).
3. Update the secrets from step 3 to the live values (`sk_live_...` and the
   live-mode `whsec_...`), then redeploy `wallet-topup-checkout` and
   `stripe-webhook`.
4. Do one small real top-up yourself to confirm everything works with real
   money before announcing it to the club.

## Follow-up: locking down the "Unrestricted" tables

If Supabase's Table Editor shows `faqs`, `finance_transactions`,
`gallery_photos`, `merchandise_items`, `merchandise_orders`,
`merchandise_sizes`, or `site_settings` as **Unrestricted** (no Row Level
Security), run [`supabase/sql/rls_content_and_orders.sql`](../sql/rls_content_and_orders.sql)
in the SQL Editor, the same way as the main migration. It doesn't need any
Edge Function changes or secrets - just run the SQL once.

Most of those tables are just content (FAQs, gallery, settings) and get
public-read/admin-write policies to clear the warning honestly. The
important one is `merchandise_orders`: without it, someone with basic dev-
tools knowledge could fabricate a cheap price on a merchandise order and
then pay that fake amount instead of the real one - the migration makes the
database itself verify an order's price against the live catalog at the
moment it's created, and locks the order against further edits by anyone
but an admin afterwards.

## What's intentionally *not* covered by this migration

- **Admin-initiated event removals** (an admin removing a no-show, or
  cancelling a whole event) still use the old, unchanged code path with no
  automatic refund - only a member cancelling *their own* signup goes
  through the new 24-hour refund logic. If an admin needs to refund someone
  removed this way, use the new balance-adjustment control on their player
  profile (Admin -> Manage Players -> click a player -> Wallet Balance).
- **Refunds in general** are manual by design (per the club's decision):
  if a member wants real money back, process it yourself via bank transfer,
  then use that same balance-adjustment control to correct their balance to
  match. There's no "refund to card" button anywhere in the app.
- **Membership cancellations** are handled case-by-case by admins, same as
  refunds - there's no self-service "cancel my membership" button.
- The rest of the admin panel (approving new registrations, verifying
  junior consent, managing events/merchandise catalog/content, etc.) is
  completely unchanged - none of it touches the newly-protected columns.
- **The existing `finance_transactions` ledger (Admin -> Finance) records
  money when it's *spent*** (membership bought, event fee paid, merch
  ordered), same as it always has, **not** when a Stripe top-up lands. A
  top-up by itself just moves money into a member's balance - it isn't
  revenue for a specific category yet. This means `finance_transactions`
  won't exactly match your Stripe payout totals on any given day (some
  top-up money may be sitting unspent in members' balances); if you want to
  reconcile actual cash received, use the Stripe Dashboard's own payment
  history alongside `finance_transactions`, not instead of it.
