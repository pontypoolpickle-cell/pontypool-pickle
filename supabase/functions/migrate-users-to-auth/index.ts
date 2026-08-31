// One-off migration tool - creates a real Supabase Auth account for every
// existing `users` row that doesn't have one yet (auth_user_id is null),
// then sends each of them a normal "reset your password" email using the
// exact same resetPasswordForEmail() mechanism the website's own "Forgot
// Password" button uses. There is nothing else to build for the "resend"
// case: if someone doesn't get their email, they (or an admin, on their
// behalf) just click Forgot Password on the site once this has run, or this
// function can be called again - it always skips anyone who already has an
// auth_user_id, so it's safe to re-run.
//
// This is a deliberately manual/operational tool, not something the website
// calls - there's no logged-in admin session to check yet at the point this
// needs to run (that's the whole point: nobody has a Supabase Auth session
// until this has run once). It's gated by a one-off shared secret instead -
// see "Required secrets" below.
//
// Usage (run once, from a terminal or the browser console while logged into
// nothing in particular - this is *not* called from the website UI):
//
//   curl -X POST 'https://<project-ref>.supabase.co/functions/v1/migrate-users-to-auth' \
//     -H 'Content-Type: application/json' \
//     -H 'x-migration-secret: <MIGRATION_ADMIN_SECRET>' \
//     -d '{"dryRun": true}'
//
// Run with `"dryRun": true` first to see who *would* be migrated without
// changing anything, then run again with `"dryRun": false` (or omit it) to
// actually do it. Pass `"usernames": ["alice", "bob"]` to retry just a
// specific subset (e.g. after fixing a bad email address).
//
// Processes at most `batchSize` people per call (default 15) and reports
// `remainingCount` - Edge Functions have a hard execution time limit, and a
// club with 100+ members doing 1-3 Auth API calls each easily blows past it
// in a single request. Just call this again (same body) if `remainingCount`
// is greater than 0 - it always skips anyone already migrated, so calling
// it repeatedly until remainingCount is 0 is the intended way to run this
// for a real club-sized membership list.
//
// Required secrets (same pattern as send-email/membership-reminders - set
// via `supabase secrets set NAME=value` or the Dashboard):
//   MIGRATION_ADMIN_SECRET     - a random string only you know; invent one,
//                                e.g. `openssl rand -hex 32`
//   SITE_URL                   - e.g. https://www.pontypoolpickle.com -
//                                used as the redirect target after someone
//                                clicks the reset-password link
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-injected by Supabase
//
// Deploy: `supabase functions deploy migrate-users-to-auth --no-verify-jwt`
// (--no-verify-jwt because this is invoked directly with the migration
// secret, not a logged-in browser session - same reasoning as
// membership-reminders).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MIGRATION_ADMIN_SECRET = Deno.env.get("MIGRATION_ADMIN_SECRET");
const SITE_URL = Deno.env.get("SITE_URL") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-migration-secret"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });

  if (!MIGRATION_ADMIN_SECRET) {
    return jsonResponse({ error: "MIGRATION_ADMIN_SECRET is not configured on the server." }, 500);
  }
  if (req.headers.get("x-migration-secret") !== MIGRATION_ADMIN_SECRET) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let payload: { dryRun?: boolean; usernames?: string[]; batchSize?: number } = {};
  try {
    payload = await req.json();
  } catch {
    // No body / not JSON - treat as defaults (dryRun: false, all users).
  }
  const dryRun = !!payload.dryRun;
  const batchSize = Math.min(Math.max(Number(payload.batchSize) || 15, 1), 50);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // A plain anon-key client, on purpose - resetPasswordForEmail() below must
  // go through the exact same code path (and therefore the exact same
  // branded email template) a real member clicking "Forgot Password" would
  // trigger, not an admin-only shortcut.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const usingExplicitList = !!(payload.usernames && payload.usernames.length > 0);
  let query = admin.from("users").select("id, username, email, auth_user_id").is("auth_user_id", null).order("username", { ascending: true });
  if (usingExplicitList) {
    query = admin.from("users").select("id, username, email, auth_user_id").in("username", payload.usernames!);
  } else if (!dryRun) {
    // Only cap the batch for the real run - dry runs are cheap (no API
    // calls at all) so it's more useful to see everyone at once there.
    query = query.limit(batchSize);
  }
  const { data: candidates, error: fetchErr } = await query;
  if (fetchErr) return jsonResponse({ error: fetchErr.message }, 500);

  const migrated: Record<string, unknown>[] = [];
  const skipped: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  for (const user of candidates || []) {
    if (user.auth_user_id) {
      skipped.push({ username: user.username, reason: "already migrated" });
      continue;
    }
    if (!user.email || user.email.indexOf("@") === -1) {
      skipped.push({ username: user.username, reason: "no email on file" });
      continue;
    }
    if (dryRun) {
      migrated.push({ username: user.username, email: user.email, dryRun: true });
      continue;
    }

    try {
      let authUserId: string | null = null;

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: { username: user.username }
      });

      if (created && created.user) {
        authUserId = created.user.id;
      } else if (createErr) {
        // Most likely "already registered" (e.g. this function is being
        // re-run after a partial failure) - find the existing auth user by
        // email instead of failing outright.
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (listErr) throw new Error(`createUser failed (${createErr.message}) and listUsers failed (${listErr.message})`);
        const existing = (list?.users || []).find((u) => (u.email || "").toLowerCase() === user.email!.toLowerCase());
        if (!existing) throw createErr;
        authUserId = existing.id;
      }

      if (!authUserId) throw new Error("Could not resolve an auth user id.");

      const { error: linkErr } = await admin.from("users").update({ auth_user_id: authUserId }).eq("id", user.id);
      if (linkErr) throw new Error(`Linked auth account but failed to save auth_user_id: ${linkErr.message}`);

      const { error: resetErr } = await anon.auth.resetPasswordForEmail(user.email, {
        redirectTo: SITE_URL || undefined
      });
      if (resetErr) throw new Error(`Account created/linked, but sending the reset email failed: ${resetErr.message}`);

      migrated.push({ username: user.username, email: user.email });
    } catch (err) {
      errors.push({ username: user.username, email: user.email, error: (err as Error).message });
    }

    // Gentle pacing - avoids hammering the Auth API / outgoing email
    // provider with a big burst of requests in the same second. Kept short
    // deliberately - this whole function has to finish well inside the
    // platform's execution time limit (see batchSize above).
    await sleep(150);
  }

  let remainingCount = 0;
  if (!dryRun && !usingExplicitList) {
    const { count } = await admin.from("users").select("id", { count: "exact", head: true }).is("auth_user_id", null);
    remainingCount = count || 0;
  }

  return jsonResponse({
    dryRun,
    batchSize,
    migratedCount: migrated.length,
    migrated,
    skippedCount: skipped.length,
    skipped,
    errorCount: errors.length,
    errors,
    remainingCount,
    hint: remainingCount > 0 ? "Call this function again with the same body to migrate the next batch." : undefined
  });
});
