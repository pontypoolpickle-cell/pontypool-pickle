import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_EMAIL = "pontypoolpickle@gmail.com";
const FROM_EMAIL = "Pontypool Pickle Club <noreply@pontypoolpickle.com>";

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

function eventBox(title: string, date: string, time: string, location: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:20px 0;">
    <tr><td colspan="2" style="padding:12px 12px 4px;font-family:Arial,sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">Event Details</td></tr>
    ${detailRow('Event', title)}
    ${detailRow('Date', date)}
    ${detailRow('Time', time)}
    ${detailRow('Location', location)}
  </table>`;
}

async function sendEmail(to: string, subject: string, html: string) {
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey"
      }
    });
  }

  try {
    const { type, data } = await req.json();

    switch (type) {

      // EMAIL 1: Contact Form
      case "contact": {
        const body = `
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#e11d48;">New Message Received</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Someone has submitted the contact form on the Pontypool Pickle Club website.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Name', data.name)}
            ${detailRow('Email', `<a href="mailto:${data.email}" style="color:#e11d48;font-weight:900;">${data.email}</a>`)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Their Message</p>
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">${data.message.replace(/\n/g, '<br>')}</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">Reply directly to <a href="mailto:${data.email}" style="color:#e11d48;">${data.email}</a>.</p>
        `;
        await sendEmail(ADMIN_EMAIL, `📬 New Inquiry from ${data.name}`, buildEmailHtml("New Inquiry", body));
        break;
      }

      // EMAIL 2: Event Signup Confirmation
      case "event_signup": {
        const paymentSection = data.isFree ? `
          <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:20px 0;text-align:center;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;font-weight:900;color:#16a34a;text-transform:uppercase;">🎉 This is a free event — no payment needed!</p>
          </div>
        ` : `
          <div style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;padding:16px 20px;margin:20px 0;">
            <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">Payment Due</p>
            <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Please log in to the website to view payment details. Payment is required at least <strong>24 hours before</strong> the event.</p>
          </div>
        `;
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">You're confirmed! We can't wait to see you on the court.</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          ${paymentSection}
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ Can't make it? Please cancel your registration on the website so your spot can go to someone on the reserve list.</p>
          </div>
          <p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">See you on the court!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `✅ You're registered! — ${data.eventTitle}`, buildEmailHtml("You're Registered!", body));
        break;
      }

      // EMAIL 3: New Member Application (to admin)
      case "new_member_admin": {
        const under18Warning = data.isUnder18 ? `
          <div style="background-color:#fff1f2;border:2px solid #e11d48;border-radius:10px;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;font-weight:900;color:#e11d48;text-transform:uppercase;">⚠️ Under 18 Application</p>
            <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#374151;">This applicant is under 18. A signed parental consent form must be received before this account is approved.</p>
          </div>
        ` : '';
        const body = `
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">A new player has submitted a membership application and is awaiting your approval in the Admin panel.</p>
          ${under18Warning}
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Full Name', `${data.firstName} ${data.surname}`)}
            ${detailRow('Username', data.username)}
            ${detailRow('Email', data.email || 'Not provided')}
            ${detailRow('Under 18?', data.isUnder18 ? 'YES — Consent form required' : 'No')}
          </table>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Log in to the club portal and visit the <strong>Admin</strong> panel to approve or reject this application.</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">If you were not expecting this application, you can safely ignore this email.</p>
        `;
        await sendEmail(ADMIN_EMAIL, `🆕 New Member Application — ${data.firstName} ${data.surname}`, buildEmailHtml("New Application", body));
        break;
      }

      // EMAIL 4: Application Received (adult)
      case "application_received_adult": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Thanks for applying to join <strong>Pontypool Pickle Club</strong>! We've received your application and an admin will review it shortly.</p>
          <div style="background-color:#f9fafb;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;">You'll receive another email as soon as your account has been approved. In the meantime, if you have any questions feel free to get in touch via the website.</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Name', `${data.firstName} ${data.surname}`)}
            ${detailRow('Username', data.username)}
          </table>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">We look forward to seeing you on the court!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🏓 Application Received — Pontypool Pickle Club`, buildEmailHtml("Application Received", body));
        break;
      }

      // EMAIL 5: Application Received (under 18)
      case "application_received_u18": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Thanks for applying to join <strong>Pontypool Pickle Club</strong>! Because you are under 18, we need a completed consent form from your parent or guardian before we can approve your account.</p>
          <div style="background-color:#fff1f2;border:2px solid #e11d48;border-radius:10px;padding:16px 20px;margin:0 0 24px;">
            <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;font-weight:900;color:#e11d48;text-transform:uppercase;">⚠️ Action Required — Parent / Guardian</p>
            <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Please download the consent form, fill it in, sign it, and email it back to <strong>pontypoolpickle@gmail.com</strong>.</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Once received we will review the application and activate the account.</p>
          </div>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="https://docs.google.com/document/d/1sb0TP4FzpGzsuSja_sj4BZhYhNrKydjv_6ZOhfMrvl8/export?format=pdf" style="display:inline-block;background-color:#000000;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-decoration:none;padding:16px 32px;border-radius:99px;">Download Consent Form (PDF) ↓</a>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Applicant Name', `${data.firstName} ${data.surname}`)}
            ${detailRow('Username', data.username)}
            ${detailRow('Return Form To', 'pontypoolpickle@gmail.com')}
          </table>
          <div style="background-color:#f9fafb;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#374151;font-weight:700;">📧 Subject line: <span style="color:#e11d48;">Consent Form — ${data.firstName} ${data.surname}</span></p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">We look forward to welcoming ${data.firstName} to the club!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🏓 Application Received — Consent Form Required`, buildEmailHtml("Application Received", body));
        break;
      }

      // EMAIL 6: Account Approved
      case "account_approved": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Great news — your application to join <strong>Pontypool Pickle Club</strong> has been approved! 🎉 You now have full access to the members' portal.</p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${data.loginUrl}" style="display:inline-block;background-color:#e11d48;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-decoration:none;padding:16px 40px;border-radius:99px;">Login To The Portal →</a>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Username', data.username)}
          </table>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">🏓 Head over to the Rating, Scramble and Ladders pages to get stuck in — and don't miss the Events page for what's coming up next!</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">See you on the court!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🎉 You're Approved! Welcome to Pontypool Pickle Club`, buildEmailHtml("You're Approved!", body));
        break;
      }

      // EMAIL 7: Account Declined
      case "account_declined": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Thank you for your interest in joining <strong>Pontypool Pickle Club</strong>. After reviewing your application, we're sorry to let you know that we're unable to approve it at this time.</p>
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">If you have any questions about this decision, or believe this may have been a mistake, please get in touch via the Contact Us page on our website.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thank you for your understanding.<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `Update on Your Pontypool Pickle Club Application`, buildEmailHtml("Application Update", body));
        break;
      }

      // EMAIL 8: Password Reset
      case "password_reset": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">We received a request to reset the password for your account. Use the code below to set a new password:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <div style="display:inline-block;background-color:#000000;border-radius:12px;padding:20px 40px;border-bottom:4px solid #e11d48;">
              <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#9ca3af;">Your Reset Code</p>
              <p style="margin:0;font-family:'Courier New',monospace;font-size:40px;font-weight:900;letter-spacing:10px;color:#ffffff;">${data.token}</p>
            </div>
          </div>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⏰ This code expires in <strong>30 minutes</strong>. Do not share it with anyone.</p>
          </div>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Enter this code on the website along with your new password to complete the reset.</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">If you didn't request a password reset, you can safely ignore this email.</p>
        `;
        await sendEmail(data.email, `🔑 Your Password Reset Code — Pontypool Pickle Club`, buildEmailHtml("Password Reset", body));
        break;
      }

      // EMAIL 9: Reserve Promoted to Confirmed
      case "reserve_promoted": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Great news — a spot has just opened up and you've been moved from the reserve list to <strong>confirmed</strong>! 🎉</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;font-weight:900;color:#16a34a;">✅ You are now confirmed for this event!</p>
          </div>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ If you can no longer attend, please cancel your registration on the website so your spot can go to someone else.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">See you on the court!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🎉 You're in! — ${data.eventTitle}`, buildEmailHtml("You're In!", body));
        break;
      }

      // EMAIL 10: Admin Removed from Event
      case "admin_removed": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">We're getting in touch to let you know that your registration for the following event has been removed by a club admin:</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">If you believe this was a mistake, please contact us via the website and we'll look into it right away.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Apologies for any inconvenience.<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `Registration Update — ${data.eventTitle}`, buildEmailHtml("Registration Update", body));
        break;
      }

      // EMAIL 11: Event Cancelled
      case "event_cancelled": {
        const optionalMsg = data.message ? `
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Message from the Club</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${data.message.replace(/\n/g, '<br>')}</p>
          </div>
        ` : '';
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">We're sorry to let you know that the following event has been <strong>cancelled</strong>:</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          ${optionalMsg}
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">We're sorry for any inconvenience. Keep an eye on the website for upcoming events!</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thank you for your understanding.<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `❌ Event Cancelled — ${data.eventTitle}`, buildEmailHtml("Event Cancelled", body));
        break;
      }

      // EMAIL 12: Accident Report
      case "accident_report": {
        const body = `
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">An accident/injury report has been submitted via the club website.</p>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">1. General Information</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Report Submitted', data.timestamp)}
            ${detailRow('Submitted By', data.submitterName)}
            ${detailRow('Contact Details', data.submitterContact)}
            ${detailRow('Role', data.role)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">2. Incident Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Injured Person', data.injuredName)}
            ${detailRow('Under 18?', data.isUnder18)}
            ${detailRow('Date of Incident', data.incidentDate)}
            ${detailRow('Time of Incident', data.incidentTime)}
            ${detailRow('Location', data.location)}
            ${detailRow('Court Number', data.courtNumber)}
            ${detailRow('Witnesses', data.witnesses)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">3. Injury Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Injury Types', data.injuryTypes)}
            ${detailRow('Body Part', data.bodyPart)}
          </table>
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Description of Incident</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${data.description.replace(/\n/g, '<br>')}</p>
          </div>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">4. Action Taken</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Venue Staff Notified?', data.venueNotified)}
            ${detailRow('Medical Interventions', data.medicalInterventions)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">5. Outcome</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Continued Playing?', data.continuedPlaying)}
            ${detailRow('Left Session Early?', data.leftEarly)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">6. Safeguarding</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Parent/Guardian Informed?', data.guardianInformed)}
            ${detailRow('Contact Attempt Details', data.guardianDetails)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">7. Additional Information</p>
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${data.additional.replace(/\n/g, '<br>')}</p>
          </div>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:20px 0 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ Please ensure this report is stored securely in accordance with your club's data protection and safeguarding policies.</p>
          </div>
        `;
        await sendEmail(ADMIN_EMAIL, `🚨 Accident Report — ${data.injuredName} (${data.incidentDate})`, buildEmailHtml("Accident Report", body));
        break;
      }

      // EMAIL 13: Reserve List Confirmation
      case "reserve_signup": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">You've been added to the reserve list for the following event. We'll be in touch the moment a confirmed spot becomes available!</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;font-weight:700;">🔄 You're currently on the <strong>reserve list</strong>. If someone cancels their spot, you'll be automatically moved up and notified by email.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Fingers crossed for a spot — we'd love to have you there!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🔄 You're on the reserve list — ${data.eventTitle}`, buildEmailHtml("On The Reserve List", body));
        break;
      }

      // EMAIL 14: Membership Payment Reported (to admin)
      case "membership_payment_notification": {
        const renewalBadge = data.isRenewal ? ` <span style="background-color:#000000;color:#ffffff;font-size:10px;font-weight:900;text-transform:uppercase;padding:2px 8px;border-radius:99px;">Renewal</span>` : '';
        const body = `
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">A member has reported a membership payment and it's awaiting your review in the Admin panel.${data.isRenewal ? ' This is a renewal request — the member keeps their current access until you review it.' : ''}</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Name', `${data.name}${renewalBadge}`)}
            ${detailRow('Username', data.username)}
            ${detailRow('Email', data.email || 'Not provided')}
            ${detailRow('Duration Requested', `${data.durationWeeks} Weeks`)}
            ${detailRow('Payment Reference', data.paymentRef)}
          </table>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Log in to the club portal and visit <strong>Admin → Manage Membership → Pending Requests</strong> to verify against the bank statement and activate.</p>
        `;
        await sendEmail(ADMIN_EMAIL, `⭐ Membership Payment Reported — ${data.name}`, buildEmailHtml("Membership Payment Received", body));
        break;
      }

      // EMAIL 15: Membership Activated (to member)
      case "membership_activated": {
        const perksHtml = (data.perks || []).map((p: string) =>
          `<li style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">${p}</li>`
        ).join('');
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Your membership is now active — welcome aboard! ⭐ Thank you for supporting Pontypool Pickle Club.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Duration', `${data.durationWeeks} Weeks`)}
            ${detailRow('Start Date', data.startDate)}
            ${detailRow('Expires', data.endDate)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">Your Member Perks</p>
          <ul style="margin:0 0 24px;padding-left:20px;">
            ${perksHtml}
          </ul>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">🔔 We'll email you a reminder a week before your membership expires — no need to keep track yourself!</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thanks again for your support!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `⭐ Your Membership is Active! — Pontypool Pickle Club`, buildEmailHtml("Membership Activated", body));
        break;
      }

      // EMAIL 16: Membership Extended / Renewed (to member)
      case "membership_extended": {
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Your membership has been extended — thanks for renewing! ⭐</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Duration Added', `${data.durationWeeks} Weeks`)}
            ${detailRow('New Expiry Date', data.endDate)}
          </table>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">🔔 We'll email you a reminder a week before your new expiry date.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thanks again for your continued support!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `⭐ Your Membership Has Been Extended — Pontypool Pickle Club`, buildEmailHtml("Membership Extended", body));
        break;
      }

      // EMAIL 17: Membership Payment Declined (to member)
      case "membership_declined": {
        const reasonBlock = data.reason ? `
          <div style="background-color:#f9fafb;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Note from the Club</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${data.reason.replace(/\n/g, '<br>')}</p>
          </div>
        ` : '';
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">We were unable to verify your recent membership payment, so your request hasn't been activated.</p>
          ${reasonBlock}
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">Please double-check the payment reference and try submitting again from the Membership page, or get in touch via the Contact Us page if you think this is a mistake.</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thanks for your understanding.<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `Update on Your Membership Request — Pontypool Pickle Club`, buildEmailHtml("Membership Request Update", body));
        break;
      }

      // EMAIL 18: Junior Player Registration & Consent Form (to admin)
      case "junior_consent_form": {
        const medicalConditionsBlock = data.medicalConditions === "Yes" ? `
          <div style="background-color:#fff1f2;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Medical Condition / Allergy / Injury Details</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${(data.medicalConditionsDetails || 'Not provided').replace(/\n/g, '<br>')}</p>
          </div>
        ` : '';
        const medicationBlock = data.medication === "Yes" ? `
          <div style="background-color:#fff1f2;border-left:4px solid #e11d48;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#9ca3af;">Medication Details / Location During Sessions</p>
            <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#374151;line-height:1.6;">${(data.medicationDetails || 'Not provided').replace(/\n/g, '<br>')}</p>
          </div>
        ` : '';
        const nominatedPersonsHtml = (data.nominatedPersons && data.nominatedPersons.length > 0)
          ? (data.nominatedPersons as string[]).map((p: string, i: number) => detailRow(`Nominated Person ${i + 1}`, p)).join('')
          : detailRow('Nominated Persons', 'N/A — Independent travel selected');
        const altContactsHtml = (data.altContacts && data.altContacts.length > 0)
          ? (data.altContacts as string[]).map((c: string, i: number) => detailRow(`Alternative Emergency Contact ${i + 1}`, c)).join('')
          : `${detailRow('Alternative Emergency Contact Name', data.altContactName)}${detailRow('Alternative Emergency Contact Number', data.altContactPhone)}`;
        const body = `
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">A parent/guardian has completed the Junior Player Registration &amp; Consent Form via the club website. Please review the details below and verify face-to-face with the family at the start of the junior's first session before activating their account.</p>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">1. Player &amp; Guardian Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Full Name of Teenager', data.teenName)}
            ${detailRow('Date of Birth', data.dob)}
            ${detailRow('Full Name of Parent/Guardian', data.guardianName)}
            ${detailRow('Guardian Primary Contact Number', data.guardianPhone)}
            ${detailRow('Guardian Email Address', `<a href="mailto:${data.guardianEmail}" style="color:#e11d48;font-weight:900;">${data.guardianEmail}</a>`)}
            ${altContactsHtml}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">2. Medical Information &amp; Emergency Protocols</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Has Medical Conditions / Allergies / Injuries?', data.medicalConditions)}
            ${detailRow('Carries / Needs Emergency Medication?', data.medication)}
            ${detailRow('Emergency Contact Acknowledged', data.emergencyContactAck)}
            ${detailRow('Self-Medication Confirmed', data.selfMedicationAck)}
            ${detailRow('999 Protocol Permission Given', data.emergency999Ack)}
          </table>
          ${medicalConditionsBlock}
          ${medicationBlock}
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">3. Travel, Dismissal &amp; Lateness Agreement</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('End of Session Option', data.dismissalOption)}
            ${nominatedPersonsHtml}
            ${detailRow('Collection & Lateness Agreement Accepted', data.latenessAck)}
            ${detailRow('Refusal to Wait Protocol Accepted', data.refusalWaitAck)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">4. Player Welfare, Dress Code &amp; Media Policies</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 20px;">
            ${detailRow('Kit & Preparedness Requirement Accepted', data.kitAck)}
            ${detailRow('Photography & Media Policy Accepted', data.photoPolicyAck)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">5. Legal Sign-Off &amp; Privacy Consent</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${detailRow('Parent/Guardian Declaration Accepted', data.declarationAck)}
            ${detailRow('In-Person Verification Agreement Accepted', data.verificationAck)}
            ${detailRow('Club Policy Acknowledgement Accepted', data.policyAck)}
            ${detailRow('UK GDPR Privacy Consent Accepted', data.gdprAck)}
            ${detailRow('Full Name of Parent/Guardian (Sign-Off)', data.parentSignName)}
            ${detailRow('Date of Submission', data.submissionDate)}
          </table>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ Reminder: the account cannot be activated until the parent/guardian has been verified face-to-face at the start of the junior's first session.</p>
          </div>
        `;
        await sendEmail(ADMIN_EMAIL, `🧾 Junior Consent Form — ${data.teenName}`, buildEmailHtml("Junior Consent Form Submitted", body));
        break;
      }

      // EMAIL 19: Payment Reminder (admin-triggered, to player)
      case "payment_reminder": {
        const paymentRef = data.paymentRef || `${data.name} - ${data.eventTitle}`;
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.name},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">Our records show that you haven't yet paid for the event below. Please make payment via bank transfer as soon as possible to keep your spot.</p>
          ${eventBox(data.eventTitle, data.eventDate, data.eventTime, data.eventLocation)}
          <div style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">Bank Transfer Details</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${detailRow('Name', 'Pontypool Pickleball')}
              ${detailRow('Sort Code', '51-61-02')}
              ${detailRow('Account No', '76584135')}
              ${detailRow('Reference', paymentRef)}
              ${data.amount ? detailRow('Amount Due', `£${data.amount}`) : ''}
            </table>
          </div>
          <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin:0 0 20px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#16a34a;font-weight:700;">✅ Already paid? If you're receiving this email but have already made the bank transfer, please go to <a href="https://www.pontypoolpickle.com" style="color:#16a34a;">www.pontypoolpickle.com</a>, open this event, and click <strong>I've Paid</strong> to update your status.</p>
          </div>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">⚠️ Failure to make payment can result in your spot being removed, with another player taking your place.</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">Thanks for your understanding.<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `⏰ Payment Reminder — ${data.eventTitle}`, buildEmailHtml("Payment Reminder", body));
        break;
      }

      // EMAIL 20: Membership Gifted Free (admin override, to member)
      case "membership_gifted": {
        const perksHtml = (data.perks || []).map((p: string) =>
          `<li style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">${p}</li>`
        ).join('');
        const intro = data.isExtension
          ? `Great news — the club has gifted you a free month of membership! 🎁 Your expiry date has been pushed back, no payment needed.`
          : `Great news — the club has gifted you a free month of membership! 🎁 No payment needed, just enjoy the perks below.`;
        const body = `
          <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#000000;">Hi ${data.firstName},</p>
          <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#374151;">${intro}</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;margin:0 0 24px;">
            ${data.isExtension ? '' : detailRow('Start Date', data.startDate)}
            ${detailRow('Expires', data.endDate)}
          </table>
          <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#e11d48;">Your Member Perks</p>
          <ul style="margin:0 0 24px;padding-left:20px;">
            ${perksHtml}
          </ul>
          <div style="background-color:#fff1f2;border-radius:10px;padding:14px 18px;margin:0 0 24px;">
            <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#e11d48;font-weight:700;">🔔 We'll email you a reminder a week before your membership expires — no need to keep track yourself!</p>
          </div>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;">See you on the courts!<br><strong>Pontypool Pickle Club</strong></p>
        `;
        await sendEmail(data.email, `🎁 You've Been Gifted a Free Month of Membership! — Pontypool Pickle Club`, buildEmailHtml("Free Membership Gifted", body));
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown email type" }), { status: 400 });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
    });
  }
});
