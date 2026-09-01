// Cancels the caller's own signup for an event, and automatically refunds
// the event fee to their wallet balance if - and only if - they paid for it
// AND they're cancelling more than 24 hours before the event starts. This
// is the club's existing published policy ("Cancellations within 24 hours
// of the event are not eligible for a refund") - this function is what
// actually enforces it now that a refund is possible at all (previously
// there was nothing to automatically refund, since payment was a bank
// transfer no admin would reverse in-app).
//
// Crediting balance has to happen server-side (via adjust_user_balance, see
// supabase/sql/wallet_stripe_auth_migration.sql) since the browser can never
// be allowed to move balance directly - so this replaces the balance-moving
// part of the old client-side cancelSignup() for self-service cancellations.
// It does not handle admin-initiated removals (an admin removing a
// no-show, or cancelling a whole event) - those still use the existing
// client-side path with no automatic refund; see supabase/functions/README.md.
//
// Required secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// Deploy: `supabase functions deploy cancel-event-signup`

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REFUND_CUTOFF_HOURS = 24;

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

// Mirrors getEventStartDateTime() on the client exactly: date + time when a
// time is set, otherwise the end of that calendar day.
function getEventStartDateTime(eventRow: { event_date: string; event_time: string | null }): Date {
  return eventRow.event_time ? new Date(`${eventRow.event_date}T${eventRow.event_time}`) : new Date(`${eventRow.event_date}T23:59:59`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const profile = await getAuthedProfile(req);
  if (!profile) return jsonResponse({ error: "Please log in first." }, 401);
  if (profile.status !== "Approved") return jsonResponse({ error: "Your account is still pending admin approval." }, 403);

  let body: { eventId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }
  if (!body.eventId) return jsonResponse({ error: "Missing eventId." }, 400);

  // Mirrors currentUserFullName() on the client and the same formula in
  // spend-balance/index.ts exactly - collapses ANY run of whitespace (not
  // just leading/trailing) to a single space, so a stray space anywhere in
  // first_name/surname can't cause this to mismatch signups.player_name.
  const fullName = `${profile.first_name} ${profile.surname}`.replace(/\s+/g, " ").trim();

  try {
    const { data: eventRow, error: eventErr } = await supabase.from("events").select("*").eq("id", body.eventId).maybeSingle();
    if (eventErr) throw new Error(eventErr.message);
    if (!eventRow) return jsonResponse({ error: "Event not found." }, 404);

    const { data: signup, error: signupErr } = await supabase
      .from("signups")
      .select("*")
      .eq("event_id", body.eventId)
      .eq("player_name", fullName)
      .neq("status", "Withdrawn")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (signupErr) throw new Error(signupErr.message);
    if (!signup) return jsonResponse({ error: "You don't have an active signup for this event." }, 404);

    const now = new Date();
    const eventStart = getEventStartDateTime(eventRow);
    const cutoff = new Date(eventStart.getTime() - REFUND_CUTOFF_HOURS * 60 * 60 * 1000);
    const eligibleForRefund = signup.payment_status === "Paid" && now < cutoff;

    const { error: withdrawErr } = await supabase
      .from("signups")
      .update({ status: "Withdrawn", withdrawn_at: now.toISOString() })
      .eq("id", signup.id);
    if (withdrawErr) throw new Error(withdrawErr.message);

    let refundedAmount = 0;
    if (eligibleForRefund) {
      const isMemberRate = signup.player_type === "Member" || signup.player_type === "Admin";
      refundedAmount = Number((isMemberRate ? eventRow.member_price : eventRow.non_member_price) || 0);
      if (refundedAmount > 0) {
        const { error: rpcErr } = await supabase.rpc("adjust_user_balance", {
          p_user_id: profile.id,
          p_amount: refundedAmount,
          p_type: "event_refund",
          p_reference_id: signup.id,
          p_stripe_session_id: null,
          p_stripe_payment_intent_id: null,
          p_note: `Refund - cancelled more than ${REFUND_CUTOFF_HOURS}h before "${eventRow.title}"`,
          p_created_by: null
        });
        if (rpcErr) throw new Error(rpcErr.message);

        try {
          await supabase.from("finance_transactions").insert({
            direction: "Out",
            amount: refundedAmount,
            category: "Event Fees",
            description: `Refund - ${eventRow.title}`,
            player_name: fullName,
            source: "Wallet"
          });
        } catch {
          // Best-effort club-wide ledger entry - never block the refund itself.
        }
      }
    }

    return jsonResponse({
      success: true,
      refunded: refundedAmount > 0,
      refundedAmount,
      reason: signup.payment_status !== "Paid" ? "nothing was paid" : (eligibleForRefund ? "cancelled in time" : `within ${REFUND_CUTOFF_HOURS}h of the event - not eligible for a refund per club policy`)
    });
  } catch (err) {
    console.error("cancel-event-signup error:", (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
