// Scheduled (pg_cron) Edge Function — runs once a day.
//
// Responsibilities (per the Membership feature spec):
//   1. Email members whose membership_end_date is exactly 7 days away, and
//      record membership_last_reminder_sent so the reminder is never sent twice.
//   2. Auto-expire any membership whose membership_end_date has already passed
//      (membership_status -> 'Expired', role -> 'Non-Member' unless Admin).
//      This is the authoritative expiry check - the client also has a
//      same-day safety net on login, but this cron job is what keeps expiry
//      accurate even if nobody logs in.
//
// Required environment variables (set via `supabase secrets set` or the
// dashboard, same project as the existing `send-email` function):
//   RESEND_API_KEY            - same Resend key used by send-email
//   SUPABASE_URL              - project URL (auto-provided by Supabase runtime)
//   SUPABASE_SERVICE_ROLE_KEY - service role key (auto-provided by Supabase
//                               runtime) - needed to bypass RLS since this is
//                               a server-side job, not a logged-in user request.
//
// Deploy: `supabase functions deploy membership-reminders --no-verify-jwt`
// (see the SQL at the bottom of this file's companion instructions for how to
// schedule it with pg_cron).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "Pontypool Pickle Club <noreply@pontypoolpickle.com>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Same visual template as send-email/index.ts (duplicated - each Edge
// Function is deployed independently, so this keeps the two self-contained) ---
function buildEmailHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr>
            <td style="background-color:#000000;border-bottom:4px solid #e11d48;padding:24px 32px;border-radius:12px 12px 0 0;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#e11d48;">Pontypool Pickle Club</p>
              <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:22px;font-weight:900;text-transform:uppercase;font-style:italic;color:#ffffff;letter-spacing:-0.5px;">${title}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:13px;font-weight:900;text-transform:uppercase;font-style:italic;color:#000000;letter-spacing:1px;">Pontypool Pickle Club</p>
              <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:2px;">Established 2026 &bull; South Wales</p>
              <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#9ca3af;">
                <a href="https://www.facebook.com/profile.php?id=61590614277267" style="color:#e11d48;text-decoration:none;font-weight:900;">Facebook</a>
                &nbsp;&bull;&nbsp;
                <a href="https://www.instagram.com/pontypoolpickleballclub/" style="color:#e11d48;text-decoration:none;font-weight:900;">Instagram</a>
                &nbsp;&bull;&nbsp;
                <a href="https://www.tiktok.com/@pontypool.pickleb" style="color:#e11d48;text-decoration:none;font-weight:900;">TikTok</a>
              </p>
              <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:10px;color:#d1d5db;">This email was sent by Pontypool Pickle Club. Please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#6b7280;border-bottom:1px solid #f3f4f6;width:35%;">${label}</td>
    <td style="padding:8px 12px;font-family:Arial,sans-serif;font-size:13px;font-weight:900;color:#000000;border-bottom:1px solid #f3f4f6;">${value}</td>
  </tr>`;
}

async function sendResendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return await res.json();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

serve(async (_req) => {
  try {
    const today = todayStr();
    const reminderCutoff = addDays(today, 7);

    // 1. Expiry reminders - anyone Active, expiring within the next 7 days, who
    // hasn't already been sent a reminder for this expiry window yet.
    const { data: dueForReminder, error: reminderErr } = await supabase
      .from("users")
      .select("id, first_name, email, membership_end_date, membership_last_reminder_sent")
      .eq("membership_status", "Active")
      .not("membership_end_date", "is", null)
      .lte("membership_end_date", reminderCutoff)
      .gt("membership_end_date", today)
      .is("membership_last_reminder_sent", null);
    if (reminderErr) throw reminderErr;

    let remindersSent = 0;
    for (const u of dueForReminder || []) {
      if (!u.email) continue;
      const body = `
        <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${u.first_name},</p>
        <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Just a friendly reminder that your Pontypool Pickle Club membership is expiring soon.</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
          ${detailRow("Expiry Date", u.membership_end_date)}
        </table>
        <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ There is no grace period - your member pricing and access will end as soon as your membership expires.</p>
        </div>
        <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Head to the Membership page on the website, select a duration, and click <strong>Renew Membership</strong> to keep your access without a gap.</p>
        <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thanks for being a member!<br><strong>Pontypool Pickle Club</strong></p>
      `;
      await sendResendEmail(u.email, "⏰ Your Membership Expires in 7 Days — Pontypool Pickle Club", buildEmailHtml("Membership Expiring Soon", body));
      await supabase.from("users").update({ membership_last_reminder_sent: today }).eq("id", u.id);
      remindersSent++;
    }

    // 2. Auto-expiry - anyone Active whose end date has already passed. No grace
    // period: access is revoked as soon as membership_end_date passes.
    const { data: lapsedRows, error: expireErr } = await supabase
      .from("users")
      .select("id, role")
      .eq("membership_status", "Active")
      .not("membership_end_date", "is", null)
      .lt("membership_end_date", today);
    if (expireErr) throw expireErr;

    let expiredCount = 0;
    for (const u of lapsedRows || []) {
      const update: Record<string, unknown> = { membership_status: "Expired" };
      if (u.role !== "Admin") update.role = "Non-Member";
      await supabase.from("users").update(update).eq("id", u.id);
      expiredCount++;
    }

    return new Response(JSON.stringify({ success: true, remindersSent, expiredCount }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
