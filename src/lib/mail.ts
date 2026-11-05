import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email over SMTP (nodemailer).
 *
 * Configured with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM. When
 * SMTP_HOST or MAIL_FROM is missing nothing is sent: in development the message is
 * printed to the server console instead so flows can still be exercised, and callers
 * get `false` back so they can fall back to showing the information in the UI.
 */

const host = process.env.SMTP_HOST?.trim();
const port = Number(process.env.SMTP_PORT) || 587;
const user = process.env.SMTP_USER?.trim();
const pass = process.env.SMTP_PASS;
const from = process.env.MAIL_FROM?.trim();
// "true"/"1" forces implicit TLS (port 465); otherwise STARTTLS is negotiated on 587/25.
const secure = /^(true|1)$/i.test(process.env.SMTP_SECURE ?? "") || port === 465;

export const mailEnabled = !!(host && from);

let transport: Transporter | null = null;
function transporter() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: pass ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

/** Public origin of the app for links in emails: APP_URL, else the request's host, else localhost. */
export function appUrl(req?: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (req) {
    const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (h) {
      const proto = req.headers.get("x-forwarded-proto") ?? (h.startsWith("localhost") || h.startsWith("127.") ? "http" : "https");
      return `${proto}://${h}`;
    }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export type Mail = { to: string; subject: string; html: string; text: string };

/** Send one message. Returns true when handed to the SMTP server, false when mail is off or sending failed (logged). */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailEnabled) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[mail] SMTP not configured; this message was NOT sent.\n[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n${mail.text}\n`);
    } else {
      console.warn(`[mail] SMTP not configured; could not send "${mail.subject}" to ${mail.to}`);
    }
    return false;
  }
  try {
    await transporter().sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return true;
  } catch (e) {
    console.error(`[mail] failed to send "${mail.subject}" to ${mail.to}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

// ---- templates --------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Shared HTML wrapper: brand header, white card, muted footer. Inline styles only (email clients). */
function layout(title: string, bodyHtml: string, footer = "You're receiving this because an account exists for this address on Bitsclock.") {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f2f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1d1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f3ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
        <tr><td style="padding:0 8px 18px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="width:36px;height:36px;border-radius:999px;background:#176643;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:16px;">B</td>
            <td style="padding-left:10px;font-size:17px;font-weight:800;color:#1a1d1a;">Bitsclock</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:20px;padding:36px 32px;box-shadow:0 1px 2px rgba(0,0,0,.05);">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.5;color:#7a827a;">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const h1 = (t: string) => `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-.01em;color:#1a1d1a;">${esc(t)}</h1>`;
const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f463f;">${t}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;"><tr><td style="border-radius:999px;background:#176643;">
     <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
   </td></tr></table>`;
const credentials = (rows: [string, string][]) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#f2f3ef;border-radius:14px;">
     ${rows.map(([k, v]) => `<tr><td style="padding:10px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7a827a;width:120px;">${esc(k)}</td><td style="padding:10px 16px 10px 0;font-size:15px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1a1d1a;">${esc(v)}</td></tr>`).join("")}
   </table>`;

/** Sent when an administrator adds a member: sign-in link plus the temporary password. */
export function invitationEmail(opts: { to: string; name: string; invitedBy: string; password: string; url: string }): Mail {
  const loginUrl = `${opts.url}/login`;
  const subject = "You've been added to Bitsclock";
  const html = layout(
    subject,
    h1(`Welcome, ${opts.name}`) +
      p(`${esc(opts.invitedBy)} added you to the Bitsclock workspace. Use the temporary password below to sign in, then change it from <strong>Settings → Password</strong> at your first opportunity.`) +
      credentials([
        ["Sign-in page", loginUrl],
        ["Email", opts.to],
        ["Password", opts.password],
      ]) +
      button(loginUrl, "Sign in to Bitsclock") +
      p(`<span style="color:#7a827a;font-size:13px;">If the button doesn't work, copy this link into your browser:<br><a href="${esc(loginUrl)}" style="color:#176643;">${esc(loginUrl)}</a></span>`),
  );
  const text = [
    `Welcome, ${opts.name}`,
    "",
    `${opts.invitedBy} added you to the Bitsclock workspace. Sign in with the temporary password below, then change it from Settings -> Password.`,
    "",
    `Sign-in page: ${loginUrl}`,
    `Email:        ${opts.to}`,
    `Password:     ${opts.password}`,
    "",
    "You're receiving this because an administrator created an account for this address on Bitsclock.",
  ].join("\n");
  return { to: opts.to, subject, html, text };
}

/** Sent when an administrator resets someone's password from the Team page. */
export function passwordResetByAdminEmail(opts: { to: string; name: string; resetBy: string; password: string; url: string }): Mail {
  const loginUrl = `${opts.url}/login`;
  const subject = "Your Bitsclock password was reset";
  const html = layout(
    subject,
    h1(`Hi ${opts.name}`) +
      p(`${esc(opts.resetBy)} reset your password. Every device has been signed out. Sign in with the temporary password below, then choose a new one from <strong>Settings → Password</strong>.`) +
      credentials([
        ["Sign-in page", loginUrl],
        ["Email", opts.to],
        ["Password", opts.password],
      ]) +
      button(loginUrl, "Sign in to Bitsclock") +
      p(`<span style="color:#7a827a;font-size:13px;">Didn't expect this? Contact your administrator.</span>`),
  );
  const text = [
    `Hi ${opts.name}`,
    "",
    `${opts.resetBy} reset your password. Every device has been signed out. Sign in with the temporary password below, then choose a new one from Settings -> Password.`,
    "",
    `Sign-in page: ${loginUrl}`,
    `Email:        ${opts.to}`,
    `Password:     ${opts.password}`,
    "",
    "Didn't expect this? Contact your administrator.",
  ].join("\n");
  return { to: opts.to, subject, html, text };
}

/** Sent by the "forgot password" flow: a 6-digit code that expires in 15 minutes. */
export function passwordResetCodeEmail(opts: { to: string; name: string; code: string; minutes: number; url: string }): Mail {
  const resetUrl = `${opts.url}/forgot-password?email=${encodeURIComponent(opts.to)}`;
  const subject = `${opts.code} is your Bitsclock reset code`;
  const html = layout(
    subject,
    h1("Reset your password") +
      p(`Hi ${esc(opts.name)}, enter this code on the reset page to choose a new password. It expires in ${opts.minutes} minutes and works once.`) +
      `<p style="margin:0 0 24px;font-size:36px;line-height:1;font-weight:800;letter-spacing:.3em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#176643;">${esc(opts.code)}</p>` +
      button(resetUrl, "Open the reset page") +
      p(`<span style="color:#7a827a;font-size:13px;">If you didn't ask to reset your password, you can ignore this email. Your password stays the same until the code is used.</span>`),
    "Never share this code. Bitsclock will never ask you for it by phone or chat.",
  );
  const text = [
    "Reset your password",
    "",
    `Hi ${opts.name}, enter this code on the reset page to choose a new password. It expires in ${opts.minutes} minutes and works once.`,
    "",
    `Code: ${opts.code}`,
    `Reset page: ${resetUrl}`,
    "",
    "If you didn't ask to reset your password, ignore this email. Your password stays the same until the code is used.",
  ].join("\n");
  return { to: opts.to, subject, html, text };
}

/** Confirmation after a successful self-service reset. */
export function passwordChangedEmail(opts: { to: string; name: string; url: string }): Mail {
  const loginUrl = `${opts.url}/login`;
  const subject = "Your Bitsclock password was changed";
  const html = layout(
    subject,
    h1("Password changed") +
      p(`Hi ${esc(opts.name)}, your password was just changed and every other device was signed out.`) +
      button(loginUrl, "Sign in") +
      p(`<span style="color:#7a827a;font-size:13px;">If this wasn't you, contact your administrator straight away so they can reset the account.</span>`),
  );
  const text = [
    "Password changed",
    "",
    `Hi ${opts.name}, your password was just changed and every other device was signed out.`,
    "",
    `Sign in: ${loginUrl}`,
    "",
    "If this wasn't you, contact your administrator straight away so they can reset the account.",
  ].join("\n");
  return { to: opts.to, subject, html, text };
}
