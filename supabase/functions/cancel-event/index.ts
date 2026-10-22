// Admin-initiated cancellation of an entire event. Sets the event to
// 'Cancelled', automatically refunds every signup that actually paid for it
// (straight to their wallet balance, same mechanism as the self-service
// cancel-event-signup refund), then emails every signed-up player.
//
// Unlike cancel-event-signup's 24-hour-before-the-event cutoff (which exists
// because *the player* chose to drop out late), there is no cutoff here:
// the club cancelled the event, not the player, so every paid signup is
// refunded in full regardless of how close to the event it is.
//
// This used to be done entirely client-side (see the comment above the
// now-removed client-side cancelEvent() in public/index.html) with no
// refund at all - see "What's intentionally *not* covered by this
// migration" in supabase/functions/README.md, which this function
// supersedes. Crediting balance has to happen server-side (via
// adjust_user_balance, see supabase/sql/wallet_stripe_auth_migration.sql)
// since the browser can never be allowed to move balance directly.
//
// Signups carry no user_id (just player_name/email - see the `signups`
// table), so each paid signup is matched back to a wallet by normalized
// full name, exactly like admin-actions' giftMembership() does. A signup
// with no matching user account (e.g. a walk-in with no login) can't be
// auto-refunded and is reported back in `unmatchedRefunds` so an admin can
// sort it out manually (see the "Refunds in general" note in
// supabase/functions/README.md for the manual fallback).
//
// Required secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// Deploy: `supabase functions deploy cancel-event`

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Item #14: a 'Pending Payment' hold occupies a real seat exactly like
// 'Confirmed' does - mirrors holdsSpot() in public/index.html.
function holdsSpot(status: string): boolean {
  return status === "Confirmed" || status === "Pending Payment";
}

function normalizeName(name: string): string {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey"
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function getAuthedProfile(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) return null;
  const { data: profile, error: profileErr } = await supabase.from("users").select("*").eq("auth_user_id", authData.user.id).maybeSingle();
  if (profileErr || !profile) return null;
  return profile;
}

async function sendCancelledEmail(data: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ type: "event_cancelled", data })
    });
  } catch (err) {
    console.warn("event_cancelled email failed:", (err as Error).message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const admin = await getAuthedProfile(req);
  if (!admin) return jsonResponse({ error: "Please log in first." }, 401);
  if (admin.role !== "Admin") return jsonResponse({ error: "Admin access required." }, 403);

  let body: { eventId?: string; message?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  if (!body.eventId) return jsonResponse({ error: "Missing eventId." }, 400);

  try {
    const { data: eventRow, error: eventErr } = await supabase.from("events").select("*").eq("id", body.eventId).maybeSingle();
    if (eventErr) throw new Error(eventErr.message);
    if (!eventRow) return jsonResponse({ error: "Event not found." }, 404);

    const { data: signups, error: signupErr } = await supabase
      .from("signups")
      .select("*")
      .eq("event_id", body.eventId)
      .neq("status", "Withdrawn");
    if (signupErr) throw new Error(signupErr.message);

    const { error: cancelErr } = await supabase.from("events").update({ status: "Cancelled" }).eq("id", body.eventId);
    if (cancelErr) throw new Error(cancelErr.message);

    // All users are fetched once up front (rather than one lookup per
    // signup) since a cancelled event can have dozens of paid signups to
    // refund - mirrors the batch-fetch-then-match pattern admin-actions'
    // giftMembership() uses for the same name-matching problem.
    const { data: allUsers, error: usersErr } = await supabase.from("users").select("id, first_name, surname, balance");
    if (usersErr) throw new Error(usersErr.message);
    const userByName = new Map<string, { id: string; first_name: string; surname: string; balance: number }>();
    for (const u of allUsers || []) {
      userByName.set(normalizeName(`${u.first_name} ${u.surname}`), u);
    }

    let refundedCount = 0;
    let refundedTotal = 0;
    const unmatchedRefunds: string[] = [];
    // Tracks exactly which signup ids actually got refunded, so the email
    // loop below reports precisely what happened instead of recomputing
    // (and potentially drifting from) this loop's own decisions.
    const refundedSignupIds = new Set<string>();

    for (const signup of signups || []) {
      if (!holdsSpot(signup.status) || signup.payment_status !== "Paid") continue;

      const isMemberRate = signup.player_type === "Member" || signup.player_type === "Admin";
      const amount = Number((isMemberRate ? eventRow.member_price : eventRow.non_member_price) || 0);
      if (amount <= 0) continue;

      const matchedUser = userByName.get(normalizeName(signup.player_name));
      if (!matchedUser) {
        unmatchedRefunds.push(signup.player_name);
        continue;
      }

      const { error: rpcErr } = await supabase.rpc("adjust_user_balance", {
        p_user_id: matchedUser.id,
        p_amount: amount,
        p_type: "event_refund",
        p_reference_id: signup.id,
        p_stripe_session_id: null,
        p_stripe_payment_intent_id: null,
        p_note: `Refund - event cancelled: "${eventRow.title}"`,
        p_created_by: admin.username
      });
      if (rpcErr) throw new Error(rpcErr.message);

      refundedCount++;
      refundedTotal += amount;
      refundedSignupIds.add(signup.id);

      try {
        await supabase.from("finance_transactions").insert({
          direction: "Out",
          amount,
          category: "Event Fees",
          description: `Refund - event cancelled: ${eventRow.title}`,
          player_name: signup.player_name,
          source: "Wallet"
        });
      } catch {
        // Best-effort club-wide ledger entry - never block a refund that
        // already succeeded.
      }
    }

    const recipients = (signups || []).filter((s: { email?: string }) => s.email && String(s.email).indexOf("@") !== -1);
    await Promise.all(recipients.map((s: { id: string; player_name: string; email: string; player_type: string | null }) => {
      const isMemberRate = s.player_type === "Member" || s.player_type === "Admin";
      const amount = Number((isMemberRate ? eventRow.member_price : eventRow.non_member_price) || 0);
      return sendCancelledEmail({
        name: s.player_name,
        email: s.email,
        eventTitle: eventRow.title,
        eventDate: eventRow.event_date,
        eventTime: eventRow.event_time,
        eventLocation: eventRow.location,
        message: body.message || "",
        refundedAmount: refundedSignupIds.has(s.id) ? amount : 0
      });
    }));

    return jsonResponse({
      success: true,
      refundedCount,
      refundedTotal,
      notifiedCount: recipients.length,
      unmatchedRefunds
    });
  } catch (err) {
    console.error("cancel-event error:", (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
