/**
 * Resend email transport.
 *
 * Lazily initialises the Resend client. When RESEND_API_KEY is absent
 * the caller receives null and must fall back to console logging.
 */
import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

const from = (): string => process.env.EMAIL_FROM ?? 'noreply@metwork.dz';

interface SendOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via Resend. Returns false when Resend is not
 * configured (no API key) so the caller can fall back to console.log.
 */
export async function sendResendEmail(opts: SendOptions): Promise<boolean> {
  const r = getResend();
  if (!r) return false;
  await r.emails.send({ from: from(), to: opts.to, subject: opts.subject, html: opts.html });
  return true;
}

/* ─────────────────────────── HTML templates ─────────────────────────── */

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Metwork</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <!-- Header -->
        <tr>
          <td style="background:#166534;padding:28px 40px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Metwork</span>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:40px;">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background:#f9fafb;border-top:1px solid #e4e4e7;">
            <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">
              You received this email from Metwork &mdash; Algeria&apos;s startup ecosystem platform.<br />
              &copy; ${new Date().getFullYear()} Metwork. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:14px 32px;background:#166534;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6;">${text}</p>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#09090b;letter-spacing:-0.3px;">${text}</h1>`;
}

export function verificationEmailHtml(link: string): string {
  return layout(`
    ${h1('Verify your email address')}
    ${p('Thanks for joining Metwork. Click the button below to confirm your email address and activate your account.')}
    ${button(link, 'Verify email address')}
    ${p(`<span style="color:#71717a;font-size:13px;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${link}</span></span>`)}
    ${p('<span style="color:#71717a;font-size:13px;">This link expires in 24 hours. If you did not create a Metwork account, you can safely ignore this email.</span>')}
  `);
}

export function passwordResetEmailHtml(link: string): string {
  return layout(`
    ${h1('Reset your password')}
    ${p('We received a request to reset the password for your Metwork account. Click the button below to choose a new password.')}
    ${button(link, 'Reset password')}
    ${p(`<span style="color:#71717a;font-size:13px;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${link}</span></span>`)}
    ${p('<span style="color:#71717a;font-size:13px;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email &mdash; your password has not changed.</span>')}
  `);
}

export function contactNotificationHtml(name: string, email: string, message: string): string {
  return layout(`
    ${h1('New contact form submission')}
    ${p(`<strong>From:</strong> ${name} &lt;${email}&gt;`)}
    <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin:16px 0;">
      <p style="margin:0;font-size:14px;color:#3f3f46;line-height:1.7;white-space:pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>
    ${p(`<a href="mailto:${email}" style="color:#166534;">Reply to ${name}</a>`)}
  `);
}
