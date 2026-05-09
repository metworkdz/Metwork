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
  const { data, error } = await r.emails.send({ from: from(), to: opts.to, subject: opts.subject, html: opts.html });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[email] Resend delivery failed:', JSON.stringify(error));
    return false;
  }
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[email] Resend sent id=${data?.id} → ${opts.to}`);
  }
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
          <td style="background:#166534;padding:24px 40px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}" style="text-decoration:none;">
              <img src="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/metworklogo.svg"
                   alt="Metwork" width="140" height="40"
                   style="display:block;height:40px;width:auto;"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" />
              <span style="display:none;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Metwork</span>
            </a>
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

export function welcomeEmailHtml(opts: { fullName: string; role: string; dashboardUrl: string }): string {
  const roleLabel =
    opts.role === 'ENTREPRENEUR' ? 'entrepreneur'
    : opts.role === 'INVESTOR'   ? 'investor'
    : opts.role === 'INCUBATOR'  ? 'incubator manager'
    : 'member';

  return layout(`
    ${h1(`Welcome to Metwork, ${opts.fullName}! 🎉`)}
    ${p(`Your account is verified and ready. You've joined as an <strong>${roleLabel}</strong> on Algeria's startup ecosystem platform.`)}
    ${p('Here&rsquo;s what you can do right now:')}
    <ul style="margin:0 0 20px;padding:0 0 0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      <li>Browse coworking spaces and apply to programs</li>
      <li>Connect with mentors and investors</li>
      <li>Explore the startup marketplace</li>
    </ul>
    ${button(opts.dashboardUrl, 'Go to your dashboard')}
    ${p('<span style="color:#71717a;font-size:13px;">If you have any questions, reply to this email or visit our help centre.</span>')}
  `);
}

export function otpEmailHtml(code: string): string {
  return layout(`
    ${h1('Your verification code')}
    ${p('Use the code below to complete your Metwork registration. It expires in <strong>10 minutes</strong>.')}
    <div style="text-align:center;margin:32px 0;">
      <span style="display:inline-block;padding:18px 40px;background:#f4f4f5;border-radius:12px;font-size:36px;font-weight:700;letter-spacing:10px;color:#09090b;font-family:monospace;">${code}</span>
    </div>
    ${p('<span style="color:#71717a;font-size:13px;">If you did not request this code, you can safely ignore this email.</span>')}
  `);
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

export function bookingReceiptEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) =>
    n === 0 ? 'Free' : `${n.toLocaleString()} DZD`;

  return layout(`
    ${h1('Booking Confirmed 🎉')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking has been confirmed. Here are your details:`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.itemName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Type</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.itemKind.charAt(0) + opts.itemKind.slice(1).toLowerCase()}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Provider</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.vendorName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Location</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Start date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">End date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.endsAt)}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:14px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Amount paid</td>
        <td style="padding:14px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">Booking reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code> &nbsp;·&nbsp; Booked on ${formatDate(opts.createdAt)}</span>`)}
    ${p('If you have any questions about your booking, please contact the provider directly or reply to this email.')}
  `);
}

/** Sent to the user when their booking is created (awaiting incubator approval). */
export function bookingPendingEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  createdAt: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1('Booking Request Received ⏳')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking request has been received and is awaiting approval from <strong>${opts.vendorName}</strong>.`)}
    ${p('Your payment has been held in escrow and will be credited to the provider upon confirmation, or fully refunded if declined.')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.itemName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Provider</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Location</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Start date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#fff9e6;border-top:1px solid #e4e4e7;">
        <td style="padding:14px 16px;font-size:14px;color:#92400e;font-weight:700;border-top:1px solid #e4e4e7;">Amount held</td>
        <td style="padding:14px 16px;font-size:16px;color:#92400e;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code> &nbsp;·&nbsp; Submitted ${formatDate(opts.createdAt)}</span>`)}
    ${p('We will notify you by email once the provider responds. You can also check your booking status in your dashboard.')}
  `);
}

/** Sent to the user when their booking is confirmed — includes a QR code. */
export function bookingConfirmedWithQrEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  createdAt: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);
  const qrData = encodeURIComponent(`METWORK:${opts.bookingId}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${qrData}`;

  return layout(`
    ${h1('Booking Confirmed! 🎉')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your booking has been confirmed. Show the QR code below at the venue.`)}
    <div style="text-align:center;margin:28px 0;">
      <img src="${qrUrl}" width="180" height="180" alt="Booking QR Code" style="border-radius:8px;border:1px solid #e4e4e7;" />
      <p style="margin:8px 0 0;font-size:12px;color:#71717a;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.itemName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Provider</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Location</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Start</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:14px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Amount paid</td>
        <td style="padding:14px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p('Present this email or QR code at the venue reception. If you have questions, contact the provider directly.')}
  `);
}

/** Sent to the user when their booking is declined. */
export function bookingDeclinedEmailHtml(opts: {
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  vendorName: string;
  totalAmount: number;
  declineReason?: string;
}): string {
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1('Booking Not Approved')}
    ${p(`Hi <strong>${opts.customerName}</strong>, unfortunately <strong>${opts.vendorName}</strong> was unable to confirm your booking for <strong>${opts.itemName}</strong>.`)}
    ${opts.declineReason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:20px 0;"><p style="margin:0;font-size:14px;color:#991b1b;"><strong>Reason:</strong> ${opts.declineReason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></div>` : ''}
    ${opts.totalAmount > 0 ? p(`<strong style="color:#166534;">Refund: ${formatAmount(opts.totalAmount)}</strong> has been returned to your Metwork wallet.`) : ''}
    ${p('You can browse other available spaces and programs on the platform. If you believe this was an error, please contact the provider directly.')}
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/** Sent to the incubator when a new booking arrives. */
export function newBookingAlertHtml(opts: {
  incubatorName: string;
  customerName: string;
  bookingId: string;
  itemName: string;
  itemKind: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  dashboardUrl: string;
}): string {
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatAmount = (n: number) => (n === 0 ? 'Free' : `${n.toLocaleString()} DZD`);

  return layout(`
    ${h1(`New Booking — ${opts.itemName}`)}
    ${p(`<strong>${opts.incubatorName}</strong> has received a new booking request.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Customer</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.customerName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Service</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.itemName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${formatDate(opts.startsAt)}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:14px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Amount</td>
        <td style="padding:14px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${formatAmount(opts.totalAmount)}</td>
      </tr>
    </table>
    ${p('Approve or decline this booking from your dashboard.')}
    ${button(opts.dashboardUrl, 'Review Bookings')}
    ${p(`<span style="color:#71717a;font-size:13px;">Reference: <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${opts.bookingId.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

export function consultationApprovedEmailHtml(opts: {
  userName: string;
  mentorName: string;
  scheduledAt: string | null;
  meetLink: string | null;
  adminNote?: string;
}): string {
  const formatDt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  return layout(`
    ${h1('Your consultation is confirmed ✅')}
    ${p(`Hi <strong>${opts.userName}</strong>, your session with <strong>${opts.mentorName}</strong> has been approved.`)}
    ${opts.scheduledAt ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:13px;color:#166534;font-weight:600;">Session date &amp; time</p>
      <p style="margin:0;font-size:16px;color:#15803d;font-weight:700;">${formatDt(opts.scheduledAt)}</p>
    </div>` : ''}
    ${opts.meetLink ? `
    <div style="margin:20px 0;">
      ${p('Join your session using the link below:')}
      ${button(opts.meetLink, '📹 Join Google Meet')}
      <p style="margin:12px 0 0;font-size:12px;color:#71717a;word-break:break-all;">${opts.meetLink}</p>
    </div>` : ''}
    ${opts.adminNote ? `${p(`<strong>Note from admin:</strong> ${opts.adminNote}`)}` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">Please be ready 5 minutes before the session starts. If you need to reschedule, contact us.</span>')}
  `);
}

export function consultationRejectedEmailHtml(opts: {
  userName: string;
  mentorName: string;
  adminNote?: string;
}): string {
  return layout(`
    ${h1('Consultation request update')}
    ${p(`Hi <strong>${opts.userName}</strong>, unfortunately your consultation request with <strong>${opts.mentorName}</strong> could not be accommodated at this time.`)}
    ${opts.adminNote ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#c2410c;font-weight:600;">Reason</p>
      <p style="margin:0;font-size:14px;color:#7c2d12;">${opts.adminNote}</p>
    </div>` : ''}
    ${p('Feel free to submit another request for a different date or time.')}
  `);
}

export function withdrawalProcessedEmailHtml(opts: {
  userName: string;
  amount: number;
  status: 'APPROVED' | 'REJECTED';
  adminNote?: string;
}): string {
  const fmtAmt = `${opts.amount.toLocaleString()} DZD`;
  const approved = opts.status === 'APPROVED';

  return layout(`
    ${h1(approved ? 'Withdrawal processed ✅' : 'Withdrawal request update')}
    ${p(`Hi <strong>${opts.userName}</strong>,`)}
    ${approved
      ? p(`Your withdrawal request for <strong>${fmtAmt}</strong> has been <strong style="color:#166534;">approved</strong> and will be transferred to your registered account within 1-3 business days.`)
      : p(`Your withdrawal request for <strong>${fmtAmt}</strong> has been <strong style="color:#dc2626;">declined</strong> and the amount has been returned to your Metwork wallet.`)}
    ${opts.adminNote ? `
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">Note</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;">${opts.adminNote}</p>
    </div>` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">If you have questions, please contact our support team.</span>')}
  `);
}

export function withdrawalRequestedEmailHtml(opts: {
  userName: string;
  amount: number;
  accountDetails: string;
}): string {
  return layout(`
    ${h1('Withdrawal request received')}
    ${p(`Hi <strong>${opts.userName}</strong>, we've received your withdrawal request for <strong>${opts.amount.toLocaleString()} DZD</strong>.`)}
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;font-weight:600;">Transfer to</p>
      <p style="margin:0;font-size:14px;color:#3f3f46;white-space:pre-line;">${opts.accountDetails}</p>
    </div>
    ${p('Our team will review your request and process the transfer within 1-3 business days. You will receive another email once it is approved.')}
    ${p('<span style="color:#71717a;font-size:13px;">Funds have been placed on hold in your wallet pending review.</span>')}
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

export function consultationApprovedMentorEmailHtml(opts: {
  mentorName: string;
  clientName: string;
  clientEmail: string;
  scheduledAt: string | null;
  meetLink: string | null;
  isOffline: boolean;
  adminNote?: string;
  dashboardUrl: string;
}): string {
  const formatDt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  return layout(`
    ${h1('New consultation confirmed 📅')}
    ${p(`Hi <strong>${opts.mentorName}</strong>, a new consultation has been confirmed and is scheduled with you.`)}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#166534;font-weight:600;">Client details</p>
      <p style="margin:0 0 4px;font-size:14px;color:#15803d;"><strong>${opts.clientName}</strong></p>
      <p style="margin:0;font-size:13px;color:#166534;">
        <a href="mailto:${opts.clientEmail}" style="color:#166534;">${opts.clientEmail}</a>
      </p>
    </div>
    ${opts.scheduledAt ? `
    <div style="background:#f9fafb;border:1px solid #e4e4e7;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:13px;color:#71717a;font-weight:600;">Date &amp; time</p>
      <p style="margin:0;font-size:16px;color:#09090b;font-weight:700;">${formatDt(opts.scheduledAt)}</p>
    </div>` : ''}
    ${opts.isOffline
      ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px 20px;margin:20px 0;">
          <p style="margin:0;font-size:14px;color:#0369a1;font-weight:600;">📍 In-person meeting — coordinate location with client directly.</p>
        </div>`
      : opts.meetLink
        ? `<div style="margin:20px 0;">
            ${p('Meeting link for this session:')}
            ${button(opts.meetLink, '📹 Join Meeting')}
            <p style="margin:12px 0 0;font-size:12px;color:#71717a;word-break:break-all;">${opts.meetLink}</p>
          </div>`
        : ''}
    ${opts.adminNote ? `${p(`<strong>Admin note:</strong> ${opts.adminNote}`)}` : ''}
    ${button(opts.dashboardUrl, 'View in Dashboard')}
  `);
}
