// Admin-only actions that touch the columns locked down in
// supabase/sql/wallet_stripe_auth_migration.sql (balance, role,
// membership_status/dates). These can no longer be written directly by the
// browser (see that file for why), so they move here, where the caller's
// admin status is verified against the database using their real Supabase
// Auth session - not a client-side `currentUser.role === 'Admin'` check,
// which would be trivial to fake once `role` itself is locked down anyway.
//
// Everything else in the existing admin panel (approving registrations,
// setting a membership number, verifying junior consent, editing events/
// merchandise, etc.) is untouched and still works exactly as it did before -
// none of those write the newly-protected columns, so there was no need to
// move them.
//
// Request body:
//   { action: "adjustBalance", userId, amount, note }
//     - amount can be positive (credit - e.g. admin processed a refund by
//       bank transfer and is now correcting the member's balance to match,
//       or a manual comp) or negative (correction/clawback). Always logged
//       to wallet_transactions with type 'admin_adjustment' and the acting
//       admin's username, so there's a full audit trail.
//   { action: "adjustMembership", username, startDate, endDate, durationWeeks }
//     - same behaviour as the old client-side adjustMembership(): lets an
//       admin manually set a member's dates (e.g. correcting a mistake).
//   { action: "giftMembership", playerName, startDate }
//     - same behaviour as the old client-side giftFreeMembership(): grants
//       one free month, extending from their current expiry if already
//       active/lapsed-but-has-a-history.
//   { action: "markOrderPaid", orderId }
//     - admin override for a merchandise order paid outside the wallet (e.g.
//       cash handed over in person) - marks it Paid without touching balance.
//
// Required secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// Deploy: `supabase functions deploy admin-actions`

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FREE_MEMBERSHIP_GIFT_WEEKS = 4;

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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addWeeksToDate(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Number(weeks) * 7);
  return d.toISOString().slice(0, 10);
}

function normalizeName(name: string): string {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Mirrors applyMembershipFields() on the client: keeps `role` in sync with
// membership_end_date, exempting Admins.
async function applyMembershipFields(userId: string, currentRole: string, fields: Record<string, unknown>) {
  const endDate = "membership_end_date" in fields ? (fields.membership_end_date as string | null) : undefined;
  const hasValidEnd = !!(endDate && endDate >= todayStr());
  const update: Record<string, unknown> = { ...fields };
  if (currentRole !== "Admin") update.role = hasValidEnd ? "Member" : "Non-Member";
  const { error } = await supabase.from("users").update(update).eq("id", userId);
  if (error) throw new Error(error.message);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const admin = await getAuthedProfile(req);
  if (!admin) return jsonResponse({ error: "Please log in first." }, 401);
  if (admin.role !== "Admin") return jsonResponse({ error: "Admin access required." }, 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  try {
    if (body.action === "adjustBalance") {
      const userId = body.userId;
      const amount = Number(body.amount);
      if (!userId || !amount) return jsonResponse({ error: "Missing userId or amount." }, 400);

      const { data: newBalance, error } = await supabase.rpc("adjust_user_balance", {
        p_user_id: userId,
        p_amount: amount,
        p_type: "admin_adjustment",
        p_reference_id: null,
        p_stripe_session_id: null,
        p_stripe_payment_intent_id: null,
        p_note: body.note || null,
        p_created_by: admin.username
      });
      if (error) throw new Error(error.message);

      return jsonResponse({ success: true, newBalance });
    }

    if (body.action === "adjustMembership") {
      const username = body.username;
      if (!username) return jsonResponse({ error: "Missing username." }, 400);
      const { data: userRow, error: fetchErr } = await supabase.from("users").select("id, role").eq("username", username).single();
      if (fetchErr) throw new Error(fetchErr.message);

      const startDate = body.startDate || null;
      const endDate = body.endDate || null;
      const hasValidEnd = !!(endDate && endDate >= todayStr());
      const status = endDate ? (hasValidEnd ? "Active" : "Expired") : "None";

      await applyMembershipFields(userRow.id, userRow.role, {
        membership_start_date: startDate,
        membership_end_date: endDate,
        membership_status: status,
        membership_duration_weeks: body.durationWeeks != null ? Number(body.durationWeeks) : undefined
      });

      return jsonResponse({ success: true });
    }

    if (body.action === "giftMembership") {
      const playerName = body.playerName;
      if (!playerName) return jsonResponse({ error: "Missing playerName." }, 400);

      const { data: users, error: fetchErr } = await supabase.from("users").select("*");
      if (fetchErr) throw new Error(fetchErr.message);
      const userRow = (users || []).find((u: any) => normalizeName(`${u.first_name} ${u.surname}`) === normalizeName(playerName));
      if (!userRow) return jsonResponse({ error: "No user account found for this player - they need to sign up first." }, 404);

      const isExtension = !!(userRow.membership_end_date && userRow.membership_end_date >= todayStr());
      const newStart = isExtension ? userRow.membership_start_date : body.startDate || todayStr();
      const newEnd = isExtension ? addWeeksToDate(userRow.membership_end_date, FREE_MEMBERSHIP_GIFT_WEEKS) : addWeeksToDate(newStart, FREE_MEMBERSHIP_GIFT_WEEKS);

      await applyMembershipFields(userRow.id, userRow.role, {
        membership_status: "Active",
        membership_duration_weeks: FREE_MEMBERSHIP_GIFT_WEEKS,
        membership_start_date: newStart,
        membership_end_date: newEnd,
        membership_requested_duration_weeks: null,
        membership_last_reminder_sent: null
      });

      return jsonResponse({ success: true, startDate: newStart, endDate: newEnd });
    }

    if (body.action === "markOrderPaid") {
      const orderId = body.orderId;
      if (!orderId) return jsonResponse({ error: "Missing orderId." }, 400);
      const { error } = await supabase.from("merchandise_orders").update({ payment_status: "Paid" }).eq("id", orderId);
      if (error) throw new Error(error.message);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unsupported action." }, 400);
  } catch (err) {
    console.error("admin-actions error:", (err as Error).message);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
