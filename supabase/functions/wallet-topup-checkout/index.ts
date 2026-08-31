// Creates a Stripe Checkout Session for a wallet top-up and hands the
// browser back a URL to redirect to. The actual balance credit never
// happens here - it only happens once Stripe calls stripe-webhook to
// confirm the payment really went through (see that function for why).
//
// This intentionally does *not* use the Stripe Node/JS SDK - Stripe's REST
// API is called directly with fetch, matching the rest of this repo's Edge
// Functions (send-email talks to Resend the same way). One dependency
// (@supabase/supabase-js) instead of two.
//
// Required secrets (`supabase secrets set NAME=value`):
//   STRIPE_SECRET_KEY  - the "Secret key" from the Stripe Dashboard
//                        (Developers -> API keys). Use the sk_test_... key
//                        while testing, switch to sk_live_... when you're
//                        ready to take real payments - see
//                        supabase/functions/README.md.
//   SITE_URL           - e.g. https://www.pontypoolpickle.com (no
//                        trailing slash) - used to build the redirect URLs
//                        Stripe sends the member back to.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-injected by Supabase
//
// Deploy: `supabase functions deploy wallet-topup-checkout`
// (no --no-verify-jwt: this *is* called from the logged-in browser, and
// Supabase's gateway checking there's a valid bearer token first is exactly
// what we want. This function then does its own extra check that the token
// belongs to a real signed-in member, not just the anon key.)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_URL = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Keeps Stripe's ~20p fixed fee from dominating a tiny top-up, and stops
// mis-typed amounts (e.g. an extra zero) from going through unnoticed.
const MIN_TOPUP_PENCE = 500; // £5
const MAX_TOPUP_PENCE = 50000; // £500

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

  const { data: profile, error: profileErr } = await supabase
    .from("users")
    .select("*")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (profileErr || !profile) return null;
  return profile;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const profile = await getAuthedProfile(req);
  if (!profile) return jsonResponse({ error: "Please log in first." }, 401);
  if (profile.status !== "Approved") return jsonResponse({ error: "Your account is still pending admin approval." }, 403);

  let body: { amountPence?: number } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const amountPence = Math.round(Number(body.amountPence || 0));
  if (!Number.isFinite(amountPence) || amountPence < MIN_TOPUP_PENCE || amountPence > MAX_TOPUP_PENCE) {
    return jsonResponse({ error: `Please choose an amount between £${(MIN_TOPUP_PENCE / 100).toFixed(2)} and £${(MAX_TOPUP_PENCE / 100).toFixed(2)}.` }, 400);
  }
  if (!profile.email) {
    return jsonResponse({ error: "Your account needs an email address on file before you can top up - please contact an admin." }, 400);
  }

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("payment_method_types[0]", "card");
  params.set("success_url", `${SITE_URL}/?topup=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${SITE_URL}/?topup=cancelled`);
  params.set("client_reference_id", profile.id);
  params.set("metadata[type]", "topup");
  params.set("metadata[user_id]", profile.id);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "gbp");
  params.set("line_items[0][price_data][unit_amount]", String(amountPence));
  params.set("line_items[0][price_data][product_data][name]", "Pontypool Pickle Club - Wallet Top-Up");
  params.set(
    "line_items[0][price_data][product_data][description]",
    `Adds £${(amountPence / 100).toFixed(2)} of club balance for ${profile.first_name} ${profile.surname} to spend on membership, events, and merchandise.`
  );

  if (profile.stripe_customer_id) {
    params.set("customer", profile.stripe_customer_id);
  } else {
    params.set("customer_email", profile.email);
    params.set("customer_creation", "always");
  }

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const session = await stripeRes.json();
  if (!stripeRes.ok) {
    console.error("Stripe checkout session error:", session);
    return jsonResponse({ error: session.error?.message || "Stripe was unable to start the checkout." }, 502);
  }

  return jsonResponse({ url: session.url });
});
