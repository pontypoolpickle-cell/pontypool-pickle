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
// Bug fix: this function used to only withdraw the signup and process the
// refund - it never promoted the next reserve, unlike the client-side
// cancelSignup() path (used for admin removals). Since self-service
// cancellation is how most people actually drop out of an event, this meant
// a freed-up Confirmed/Pending Payment spot would just sit empty until an
// admin happened to edit the event (which also triggers promotion) or
// someone else's browser ran the opportunistic expireStalePendingReservations()
// sweep. This now promotes the next reserve (and emails them) itself,
// mirroring promoteReservesForEvent() in public/index.html exactly.
//
// Required secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// Deploy: `supabase functions deploy cancel-event-signup`

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REFUND_CUTOFF_HOURS = 24;

// Item #14: a 'Pending Payment' hold occupies a real seat exactly like
// 'Confirmed' does - mirrors holdsSpot() in public/index.html.
function holdsSpot(status: string): boolean {
  return status === "Confirmed" || status === "Pending Payment";
}

// Mirrors isEventPriceFree() in public/index.html exactly.
function isEventPriceFree(eventRow: { newcomers_only?: boolean; member_price?: number; non_member_price?: number }): boolean {
  return !!eventRow.newcomers_only || (!Number(eventRow.member_price) && !Number(eventRow.non_member_price));
}

// Mirrors RESERVE_PROMOTION_PAYMENT_WINDOW_HOURS in public/index.html exactly.
const RESERVE_PROMOTION_PAYMENT_WINDOW_HOURS = 48;

// Best-effort reserve-promoted email, reusing the existing send-email
// function/template infrastructure. Never throws - a failed notification
// must never undo (or appear to undo) a promotion that already succeeded.
async function sendReservePromotedEmail(data: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ type: "reserve_promoted", data })
    });
  } catch (err) {
    console.warn("reserve_promoted email failed:", (err as Error).message);
  }
}

// Server-side mirror of promoteReservesForEvent() in public/index.html -
// promotes the earliest-queued reserve(s) (Members/Admins first) into the
// spot(s) freed up by this cancellation, straight to 'Confirmed' for a free
// event or into the same 'Pending Payment' hold (with a 48h - or
// time-till-event, whichever is sooner - deadline to pay) a fresh paid
// signup uses, then emails them. Kept in sync with the client-side copy
// deliberately rather than factored out, since there's no shared module
// between the Deno Edge Functions and the browser bundle.
async function promoteReservesForEvent(eventRow: {
  id: string;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string;
  max_players: number | null;
  member_price: number | null;
  non_member_price: number | null;
  newcomers_only?: boolean;
}) {
  const maxPlayers = Number(eventRow.max_players || 0);
  if (!maxPlayers) return;

  const { data: allSignups, error } = await supabase
    .from("signups")
    .select("*")
    .eq("event_id", eventRow.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const confirmedCount = (allSignups || []).filter((s: { status: string }) => holdsSpot(s.status)).length;
  const spotsOpen = maxPlayers - confirmedCount;
  if (spotsOpen <= 0) return;

  // Members/Admins get priority; within the same priority tier, earliest
  // reserved wins (Array.prototype.sort is stable, and allSignups is
  // already ordered by created_at ascending).
  const reserves = (allSignups || [])
    .filter((s: { status: string }) => s.status === "Reserve")
    .sort((a: { player_type: string | null }, b: { player_type: string | null }) => {
      const aPriority = (a.player_type === "Member" || a.player_type === "Admin") ? 0 : 1;
      const bPriority = (b.player_type === "Member" || b.player_type === "Admin") ? 0 : 1;
      return aPriority - bPriority;
    });

  const toPromote = reserves.slice(0, spotsOpen);
  if (toPromote.length === 0) return;

  const isFree = isEventPriceFree(eventRow);
  let reservedUntil: string | null = null;
  if (!isFree) {
    const defaultDeadline = Date.now() + RESERVE_PROMOTION_PAYMENT_WINDOW_HOURS * 3600000;
    const eventStart = eventRow.event_date
      ? new Date(`${eventRow.event_date}T${eventRow.event_time || "23:59:59"}`).getTime()
      : null;
    reservedUntil = new Date(eventStart ? Math.min(defaultDeadline, eventStart) : defaultDeadline).toISOString();
  }

  for (const signup of toPromote) {
    const { error: updateErr } = await supabase
      .from("signups")
      .update({ status: isFree ? "Confirmed" : "Pending Payment", reserved_until: reservedUntil })
      .eq("id", signup.id);
    if (updateErr) throw new Error(updateErr.message);

    if (signup.email && String(signup.email).indexOf("@") !== -1) {
      await sendReservePromotedEmail({
        name: signup.player_name,
        email: signup.email,
        eventTitle: eventRow.title,
        eventDate: eventRow.event_date,
        eventTime: eventRow.event_time,
        eventLocation: eventRow.location,
        paymentRequired: !isFree
      });
    }
  }
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

    // Only promote a reserve when a real seat was actually vacated - either a
    // Confirmed player, or a Pending Payment hold being cancelled - not when
    // someone merely leaves the reserve list (no seat freed up there). This
    // is wrapped so a (very unlikely) promotion failure never undoes - or
    // reports as a failure - the cancellation that already succeeded above.
    if (holdsSpot(signup.status)) {
      try {
        await promoteReservesForEvent(eventRow);
      } catch (err) {
        console.error("promoteReservesForEvent error:", (err as Error).message);
      }
    }

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
