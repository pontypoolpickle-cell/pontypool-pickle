// Stripe calls this function directly (not the browser) whenever a payment
// event happens. It's the *only* place a wallet top-up is ever credited -
// the front-end never tells us "the payment worked", because that would be
// trivial to fake. Instead we verify Stripe's own cryptographic signature on
// the request, and only then call adjust_user_balance() (see
// supabase/sql/wallet_stripe_auth_migration.sql).
//
// Required secrets (`supabase secrets set NAME=value`):
//   STRIPE_SECRET_KEY          - not actually used by this function, but see
//                                wallet-topup-checkout, which shares the
//                                same Stripe account
//   STRIPE_WEBHOOK_SECRET      - the "Signing secret" shown on the specific
//                                webhook endpoint you create in the Stripe
//                                Dashboard (Developers -> Webhooks). Each
//                                endpoint (test mode vs live mode) has its
//                                own secret - see supabase/functions/README.md.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-injected by Supabase
//
// Deploy: `supabase functions deploy stripe-webhook --no-verify-jwt`
// (--no-verify-jwt because Stripe sends its own `Stripe-Signature` header,
// not a Supabase-issued JWT - Supabase's gateway would otherwise reject the
// request before it even reaches this code, same reasoning as
// membership-reminders' pg_cron calls).
//
// In the Stripe Dashboard, point the webhook endpoint at:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook
// and subscribe it to these events (only these two are handled below):
//   checkout.session.completed
//   checkout.session.async_payment_succeeded

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

// Re-implements Stripe's own signature check (https://stripe.com/docs/webhooks/signatures)
// without pulling in the full Stripe SDK, matching this repo's existing
// "plain fetch, minimal dependencies" style for Edge Functions.
async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").reduce((acc: Record<string, string[]>, part) => {
    const [key, value] = part.split("=");
    if (!key || value === undefined) return acc;
    (acc[key] = acc[key] || []).push(value);
    return acc;
  }, {});

  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] || [];
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((sig) => sig === expected);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Best-effort receipt email, reusing the existing send-email function/
// template infrastructure rather than duplicating Resend-calling code here.
// Never throws - a failed receipt email must never cause Stripe to retry a
// webhook whose balance credit already succeeded.
async function sendTopupReceiptEmail(userId: string, amount: number, newBalance: number) {
  try {
    const { data: profile } = await supabase.from("users").select("first_name, email").eq("id", userId).maybeSingle();
    if (!profile?.email) return;
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        type: "wallet_topup_receipt",
        data: { firstName: profile.first_name, email: profile.email, amount, newBalance }
      })
    });
  } catch (err) {
    console.warn("wallet_topup_receipt email failed:", (err as Error).message);
  }
}

serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Stripe-Signature");

  const isValid = await verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return jsonResponse({ error: "Invalid Stripe signature." }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  // Idempotency: Stripe retries delivery until it gets a 2xx, and can also
  // send duplicate events in normal operation. Inserting first and bailing
  // out on a conflict means a retried event can never credit balance twice.
  const { error: dedupeErr } = await supabase.from("processed_stripe_events").insert({ stripe_event_id: event.id });
  if (dedupeErr) {
    // Unique violation => we've already handled this event id.
    if ((dedupeErr as any).code === "23505") {
      return jsonResponse({ received: true, alreadyProcessed: true });
    }
    console.error("processed_stripe_events insert failed:", dedupeErr.message);
    return jsonResponse({ error: dedupeErr.message }, 500);
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;

      if (session.payment_status !== "paid") {
        // e.g. a delayed payment method that hasn't actually settled yet -
        // async_payment_succeeded (or a later completed event) will follow.
        return jsonResponse({ received: true, skipped: "not yet paid" });
      }

      const metadataType = session.metadata?.type;
      if (metadataType === "topup") {
        const userId = session.metadata?.user_id;
        const amount = Number(session.amount_total || 0) / 100;
        if (!userId || amount <= 0) {
          throw new Error(`Bad topup session metadata: user_id=${userId} amount_total=${session.amount_total}`);
        }

        const { data: newBalance, error: rpcErr } = await supabase.rpc("adjust_user_balance", {
          p_user_id: userId,
          p_amount: amount,
          p_type: "topup",
          p_reference_id: null,
          p_stripe_session_id: session.id,
          p_stripe_payment_intent_id: session.payment_intent || null,
          p_note: "Stripe wallet top-up",
          p_created_by: null
        });
        if (rpcErr) throw new Error(rpcErr.message);

        if (session.customer) {
          await supabase.from("users").update({ stripe_customer_id: session.customer }).eq("id", userId).is("stripe_customer_id", null);
        }

        await sendTopupReceiptEmail(userId, amount, newBalance as number);
      }
    }

    return jsonResponse({ received: true });
  } catch (err) {
    console.error("stripe-webhook processing error:", (err as Error).message);
    // Remove the dedupe row so Stripe's automatic retry has a chance to
    // succeed once whatever failed (a transient DB blip, etc.) is resolved.
    await supabase.from("processed_stripe_events").delete().eq("stripe_event_id", event.id);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
