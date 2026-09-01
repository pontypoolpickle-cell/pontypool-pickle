// Spends wallet balance on membership / an event fee / a merchandise order.
// This is the server-side replacement for the old "bank transfer + self-
// report + admin reviews the statement" flow - now that money only ever
// enters the system through Stripe (verified in stripe-webhook), spending it
// can be instant and doesn't need a human to double-check it: this function
// is the *only* place that debits balance, always using a trusted,
// server-computed price (never a price the browser sends us), and always
// via adjust_user_balance() so a double-click or two open tabs can never
// spend the same pound twice.
//
// Request body: { type: "membership", durationWeeks: number }
//             | { type: "event", eventId: string }
//             | { type: "merch", orderId: string }
//
// For "event": the signup row must already exist (created by the existing,
// unchanged signupForEvent()/signupAsReserve() client code, which still
// owns all the eligibility/capacity/priority-window logic) with
// payment_status = 'Unpaid'. This function only handles turning that
// existing hold into a paid, confirmed spot.
//
// For "merch": the order row must already exist (created by the existing
// placeMerchandiseOrder() client code) with payment_status = 'Unpaid'.
//
// For "membership": there's no separate "order" row - paying immediately
// activates membership (no more admin approval step, since a verified
// balance debit is stronger proof of payment than a bank-transfer
// self-report ever was).
//
// Required secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// Deploy: `supabase functions deploy spend-balance`

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

function addWeeksToDate(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Number(weeks) * 7);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function debit(userId: string, amount: number, type: string, referenceId: string | null, note: string) {
  const { data: newBalance, error } = await supabase.rpc("adjust_user_balance", {
    p_user_id: userId,
    p_amount: -amount,
    p_type: type,
    p_reference_id: referenceId,
    p_stripe_session_id: null,
    p_stripe_payment_intent_id: null,
    p_note: note,
    p_created_by: null
  });
  if (error) throw new Error(error.message === "Insufficient balance" ? "Insufficient balance" : error.message);
  return newBalance as number;
}

// Assigns the next sequential membership number (PPC-0001, PPC-0002, ...) the
// moment membership actually goes Active from a real payment - not when the
// account was created/approved (see the schema comment near `membership_number`
// in public/index.html for why that distinction matters). No-ops if this user
// already has a number (e.g. renewing an existing membership). Retries a
// handful of times on a unique-constraint collision, which can only happen if
// two memberships are activated in the same instant.
async function assignNextMembershipNumberIfNeeded(userId: string): Promise<void> {
  const { data: userRow, error: fetchErr } = await supabase.from("users").select("membership_number").eq("id", userId).maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (userRow && userRow.membership_number) return;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRows, error: maxErr } = await supabase
      .from("users").select("membership_number")
      .not("membership_number", "is", null)
      .order("membership_number", { ascending: false })
      .limit(1);
    if (maxErr) throw new Error(maxErr.message);
    const next = (maxRows && maxRows[0] ? Number(maxRows[0].membership_number) : 0) + 1;

    const { error: updateErr } = await supabase
      .from("users").update({ membership_number: next })
      .eq("id", userId).is("membership_number", null);
    if (!updateErr) return;
    if (!/duplicate key|unique constraint/i.test(updateErr.message)) throw new Error(updateErr.message);
    // Someone else grabbed `next` in the same instant - loop and try the new max.
  }
  throw new Error("Could not assign a membership number - please try again.");
}

async function recordFinanceTransaction(fields: Record<string, unknown>) {
  try {
    await supabase.from("finance_transactions").insert({
      transaction_date: fields.date || todayStr(),
      direction: fields.direction,
      amount: fields.amount,
      category: fields.category,
      description: fields.description || null,
      player_name: fields.playerName || null,
      source: fields.source || "Wallet",
      added_by: null
    });
  } catch {
    // Best-effort ledger entry - never let a finance-side hiccup block the
    // real payment that already succeeded (matches the existing
    // recordFinanceTransaction() convention on the client).
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const profile = await getAuthedProfile(req);
  if (!profile) return jsonResponse({ error: "Please log in first." }, 401);
  if (profile.status !== "Approved") return jsonResponse({ error: "Your account is still pending admin approval." }, 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const fullName = `${profile.first_name} ${profile.surname}`.trim();

  try {
    if (body.type === "membership") {
      const durationWeeks = Number(body.durationWeeks);
      if (!durationWeeks) return jsonResponse({ error: "Please select a membership duration." }, 400);

      const { data: plan, error: planErr } = await supabase.from("membership_plans").select("*").eq("duration_weeks", durationWeeks).maybeSingle();
      if (planErr) throw new Error(planErr.message);
      if (!plan) return jsonResponse({ error: "That membership duration is no longer available." }, 400);

      const price = Number(plan.price || 0);
      if (price > 0 && Number(profile.balance || 0) < price) {
        return jsonResponse({ error: "Insufficient balance", price, balance: Number(profile.balance || 0) }, 402);
      }

      const isExtension = !!(profile.membership_end_date && profile.membership_end_date >= todayStr());
      const newStart = isExtension ? profile.membership_start_date : todayStr();
      const newEnd = isExtension ? addWeeksToDate(profile.membership_end_date, durationWeeks) : addWeeksToDate(newStart, durationWeeks);

      if (price > 0) await debit(profile.id, price, "membership", null, `Membership - ${durationWeeks} weeks${isExtension ? " (renewal)" : ""}`);

      const update: Record<string, unknown> = {
        membership_status: "Active",
        membership_duration_weeks: durationWeeks,
        membership_start_date: newStart,
        membership_end_date: newEnd,
        membership_requested_duration_weeks: null,
        membership_last_reminder_sent: null
      };
      if (profile.role !== "Admin") update.role = "Member";
      const { error: updateErr } = await supabase.from("users").update(update).eq("id", profile.id);
      if (updateErr) throw new Error(updateErr.message);

      // Item #17 fix: the membership number is earned by paying, not by
      // registering - assign it here, the moment membership actually goes
      // Active, rather than back when the account was first approved.
      await assignNextMembershipNumberIfNeeded(profile.id);

      if (price > 0) {
        await recordFinanceTransaction({
          direction: "In",
          amount: price,
          category: "Membership",
          description: `Membership - ${durationWeeks} weeks${isExtension ? " (renewal)" : ""}`,
          playerName: fullName,
          source: "Wallet"
        });
      }

      return jsonResponse({ success: true, membershipStartDate: newStart, membershipEndDate: newEnd });
    }

    if (body.type === "event") {
      const eventId = body.eventId;
      if (!eventId) return jsonResponse({ error: "Missing eventId." }, 400);

      const { data: eventRow, error: eventErr } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
      if (eventErr) throw new Error(eventErr.message);
      if (!eventRow) return jsonResponse({ error: "Event not found." }, 404);

      const { data: signup, error: signupErr } = await supabase
        .from("signups")
        .select("*")
        .eq("event_id", eventId)
        .eq("player_name", fullName)
        .neq("status", "Withdrawn")
        .neq("payment_status", "Paid")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (signupErr) throw new Error(signupErr.message);
      if (!signup) return jsonResponse({ error: "No unpaid signup found for this event. Please sign up first." }, 404);

      // Item #8: reserves don't pay until they're actually promoted to a real
      // spot (status flips to 'Pending Payment'/'Confirmed' - see
      // promoteReservesForEvent() on the client). Block it here too, not just by
      // hiding the "Make Payment" button client-side, since this is the only
      // thing allowed to move money.
      if (signup.status === "Reserve") {
        return jsonResponse({ error: "You're still on the reserve list - there's nothing to pay yet. You'll be asked to pay only if you're promoted to a confirmed spot." }, 400);
      }

      const isMemberRate = signup.player_type === "Member" || signup.player_type === "Admin";
      const price = Number((isMemberRate ? eventRow.member_price : eventRow.non_member_price) || 0);

      if (price > 0 && Number(profile.balance || 0) < price) {
        return jsonResponse({ error: "Insufficient balance", price, balance: Number(profile.balance || 0) }, 402);
      }
      if (price > 0) await debit(profile.id, price, "event_fee", signup.id, eventRow.title || "Event signup");

      const update: Record<string, unknown> = { payment_status: "Paid" };
      if (signup.status === "Pending Payment") {
        update.status = "Confirmed";
        update.reserved_until = null;
      }
      const { error: updateErr } = await supabase.from("signups").update(update).eq("id", signup.id);
      if (updateErr) throw new Error(updateErr.message);

      if (price > 0) {
        await recordFinanceTransaction({
          direction: "In",
          amount: price,
          category: "Event Fees",
          description: eventRow.title || "Event signup",
          playerName: fullName,
          source: "Wallet"
        });
      }

      return jsonResponse({ success: true });
    }

    if (body.type === "merch") {
      const orderId = body.orderId;
      if (!orderId) return jsonResponse({ error: "Missing orderId." }, 400);

      const { data: order, error: orderErr } = await supabase.from("merchandise_orders").select("*").eq("id", orderId).maybeSingle();
      if (orderErr) throw new Error(orderErr.message);
      if (!order) return jsonResponse({ error: "Order not found." }, 404);
      if (order.username !== profile.username) return jsonResponse({ error: "This order doesn't belong to you." }, 403);
      if (order.payment_status === "Paid") return jsonResponse({ success: true, alreadyPaid: true });

      const price = Number(order.total_price || 0);
      if (price > 0 && Number(profile.balance || 0) < price) {
        return jsonResponse({ error: "Insufficient balance", price, balance: Number(profile.balance || 0) }, 402);
      }
      if (price > 0) await debit(profile.id, price, "merch", order.id, `Merchandise - ${order.item_name} (${order.size_label})`);

      const { error: updateErr } = await supabase.from("merchandise_orders").update({ payment_status: "Paid" }).eq("id", order.id);
      if (updateErr) throw new Error(updateErr.message);

      if (price > 0) {
        await recordFinanceTransaction({
          direction: "In",
          amount: price,
          category: "Merchandise",
          description: `${order.item_name} (${order.size_label})`,
          playerName: fullName,
          source: "Wallet"
        });
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unsupported type." }, 400);
  } catch (err) {
    const message = (err as Error).message;
    if (message === "Insufficient balance") return jsonResponse({ error: message }, 402);
    console.error("spend-balance error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
