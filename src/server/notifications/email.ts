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
  /** Optional file attachments — e.g. PDF receipts. */
  attachments?: Array<{ filename: string; content: Buffer }>;
}

/**
 * Send an email via Resend. Returns false when Resend is not
 * configured (no API key) so the caller can fall back to console.log.
 */
export async function sendResendEmail(opts: SendOptions): Promise<boolean> {
  const r = getResend();
  if (!r) return false;
  await r.emails.send({
    from:        from(),
    to:          opts.to,
    subject:     opts.subject,
    html:        opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content:  a.content.toString('base64'),
    })),
  });
  return true;
}

/* ─────────────────────────── HTML templates ─────────────────────────── */

export function layout(content: string): string {
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
          <td style="background:#30a735;padding:24px 40px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}" style="text-decoration:none;">
              <img src="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/Metworkwhitelogo.png"
                   alt="Metwork" width="160" height="44"
                   style="display:block;height:44px;width:auto;"
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
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:14px 32px;background:#30a735;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${label}</a>`;
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

/* ─────────────── Incubator approval (admin gate) ─────────────── */

interface IncubatorApprovalCopy {
  subject: string;
  heading: string;
  intro: string;
  next: string;
  cta: string;
  footer: string;
}

/** Localized strings for the incubator-approval email. */
const INCUBATOR_APPROVAL_COPY: Record<'en' | 'fr', (incubatorName: string) => IncubatorApprovalCopy> = {
  en: (name) => ({
    subject: 'Your incubator is approved on Metwork',
    heading: `${name} is approved! 🎉`,
    intro:
      'Great news — your incubator profile has just been approved by the Metwork team. ' +
      'Your coworking spaces, programs and events are now visible to the public on the platform.',
    next: 'Here\'s what you can do next:',
    cta: 'Open your dashboard',
    footer: 'Need help getting started? Reply to this email and our team will guide you.',
  }),
  fr: (name) => ({
    subject: 'Votre incubateur est approuvé sur Metwork',
    heading: `${name} est approuvé ! 🎉`,
    intro:
      'Bonne nouvelle — votre profil d\'incubateur vient d\'être approuvé par l\'équipe Metwork. ' +
      'Vos espaces de coworking, programmes et événements sont désormais visibles publiquement sur la plateforme.',
    next: 'Voici ce que vous pouvez faire maintenant :',
    cta: 'Accéder à mon tableau de bord',
    footer: 'Besoin d\'aide pour démarrer ? Répondez à cet e-mail et notre équipe vous accompagnera.',
  }),
};

export function incubatorApprovalEmailHtml(opts: {
  incubatorName: string;
  dashboardUrl: string;
  lang?: 'en' | 'fr';
}): string {
  const lang = opts.lang === 'fr' ? 'fr' : 'en';
  const c = INCUBATOR_APPROVAL_COPY[lang](opts.incubatorName);
  const bullets =
    lang === 'fr'
      ? [
          'Publier vos espaces et activer les réservations',
          'Créer programmes et événements pour votre communauté',
          'Inviter votre équipe et gérer les paiements',
        ]
      : [
          'Publish spaces and start accepting bookings',
          'Create programs and events for your community',
          'Invite your team and manage payouts',
        ];

  return layout(`
    ${h1(c.heading)}
    ${p(c.intro)}
    ${p(c.next)}
    <ul style="margin:0 0 20px;padding:0 0 0 20px;color:#3f3f46;font-size:15px;line-height:2;">
      ${bullets.map((b) => `<li>${b}</li>`).join('')}
    </ul>
    ${button(opts.dashboardUrl, c.cta)}
    ${p(`<span style="color:#71717a;font-size:13px;">${c.footer}</span>`)}
  `);
}

/**
 * Send the "your incubator is approved" email when an admin transitions an
 * incubator from PENDING → ACTIVE. Falls back to console logging when no
 * Resend API key is configured (same convention as every other sender here).
 */
export async function sendIncubatorApprovalEmail(opts: {
  to: string;
  incubatorName: string;
  lang?: 'en' | 'fr';
}): Promise<boolean> {
  const lang = opts.lang === 'fr' ? 'fr' : 'en';
  const subject = INCUBATOR_APPROVAL_COPY[lang](opts.incubatorName).subject;
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard`;
  const html = incubatorApprovalEmailHtml({
    incubatorName: opts.incubatorName,
    dashboardUrl,
    lang,
  });
  const delivered = await sendResendEmail({ to: opts.to, subject, html });
  if (!delivered) {
    // Resend not configured — log for ops visibility.
    console.log('[email/incubator-approval]', { to: opts.to, subject });
  }
  return delivered;
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

/** Consultant portal sign-in link (magic link). Single-use, 30-minute expiry. */
export function consultantMagicLinkEmailHtml(link: string, lang: 'en' | 'fr' = 'fr'): string {
  if (lang === 'en') {
    return layout(`
      ${h1('Sign in to your consultant portal')}
      ${p('Click the button below to access your Metwork consultant dashboard — manage your sessions, meeting links, and earnings.')}
      ${button(link, 'Open my portal')}
      ${p(`<span style="color:#71717a;font-size:13px;">Or copy this link into your browser:<br /><span style="word-break:break-all;">${link}</span></span>`)}
      ${p('<span style="color:#71717a;font-size:13px;">This link expires in 30 minutes and can be used once. If you did not request it, you can safely ignore this email.</span>')}
    `);
  }
  return layout(`
    ${h1('Connexion à votre espace consultant')}
    ${p('Cliquez sur le bouton ci-dessous pour accéder à votre tableau de bord consultant Metwork — gérez vos sessions, vos liens de réunion et vos revenus.')}
    ${button(link, 'Ouvrir mon espace')}
    ${p(`<span style="color:#71717a;font-size:13px;">Ou copiez ce lien dans votre navigateur :<br /><span style="word-break:break-all;">${link}</span></span>`)}
    ${p('<span style="color:#71717a;font-size:13px;">Ce lien expire dans 30 minutes et est à usage unique. Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail.</span>')}
  `);
}

/** Sent to the client once their paid consultation has a confirmed meeting format (READY). */
export function consultationReadyEmailHtml(params: {
  clientName: string;
  mentorName: string;
  meetingMode: 'ONLINE' | 'OFFLINE' | null;
  meetingLink: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  lang: 'en' | 'fr';
}): string {
  const isFr = params.lang === 'fr';
  const slot = params.scheduledAt
    ? new Date(params.scheduledAt).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' })
    : null;
  const dur = params.durationMinutes ? `${params.durationMinutes} min` : null;
  const details = [
    slot ? `${isFr ? 'Date' : 'Date'} : ${slot}` : null,
    dur ? `${isFr ? 'Durée' : 'Duration'} : ${dur}` : null,
    params.meetingMode === 'OFFLINE' ? (isFr ? 'Format : en présentiel' : 'Format: in person') : null,
  ].filter(Boolean).join('<br />');

  return layout(`
    ${h1(isFr ? 'Votre consultation est prête' : 'Your consultation is ready')}
    ${p(isFr
      ? `Bonjour ${params.clientName}, votre session avec ${params.mentorName} est confirmée.`
      : `Hi ${params.clientName}, your session with ${params.mentorName} is confirmed.`)}
    ${details ? p(`<span style="color:#3f3f46;">${details}</span>`) : ''}
    ${params.meetingMode === 'ONLINE' && params.meetingLink
      ? button(params.meetingLink, isFr ? 'Rejoindre la réunion' : 'Join the meeting')
      : ''}
    ${params.meetingMode === 'ONLINE' && params.meetingLink
      ? p(`<span style="color:#71717a;font-size:13px;">${isFr ? 'Ou copiez ce lien :' : 'Or copy this link:'}<br /><span style="word-break:break-all;">${params.meetingLink}</span></span>`)
      : ''}
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

/* ─────────────────── Booking receipt email bodies ─────────────────── */

interface ReceiptEmailParams {
  clientName:     string;
  incubatorName:  string;
  itemName:       string;
  reference:      string;
  startsAt:       string;
  endsAt:         string;
  totalAmount:    number;
  paymentMethod:  string;
  lang:           'en' | 'fr';
}

export function bookingReceiptEmailHtml(params: ReceiptEmailParams): string {
  const {
    clientName, incubatorName, itemName, reference,
    startsAt, endsAt, totalAmount, paymentMethod, lang,
  } = params;

  const isFr = lang === 'fr';

  function fmtDt(iso: string): string {
    try {
      return new Date(iso).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      });
    } catch { return iso; }
  }

  const fmtAmt = (n: number) =>
    n === 0
      ? (isFr ? 'Gratuit' : 'Free')
      : n.toLocaleString('fr-DZ') + ' DZD';

  const greeting = isFr
    ? `Bonjour ${clientName},`
    : `Hello ${clientName},`;

  const bodyText = isFr
    ? `Votre réservation chez <strong>${incubatorName}</strong> a été confirmée avec succès. Veuillez trouver ci-joint votre reçu PDF.`
    : `Your booking with <strong>${incubatorName}</strong> has been confirmed. Please find your PDF receipt attached.`;

  const rows = [
    [isFr ? 'Prestation'       : 'Item',           itemName],
    [isFr ? 'Du'               : 'From',            fmtDt(startsAt)],
    [isFr ? 'Au'               : 'To',              fmtDt(endsAt)],
    [isFr ? 'Mode de paiement' : 'Payment method',  paymentMethod],
    [isFr ? 'Total'            : 'Total',           fmtAmt(totalAmount)],
    [isFr ? 'Référence'        : 'Reference',       reference],
  ];

  const tableRows = rows
    .map(([label, value]) =>
      `<tr>
         <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${label}</td>
         <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${value ?? '—'}</td>
       </tr>`,
    )
    .join('');

  const title = isFr ? 'Votre reçu de réservation' : 'Your booking receipt';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${tableRows}
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Ce reçu est votre preuve de paiement. Conservez-le précieusement.'
        : 'This receipt is your proof of payment. Please keep it for your records.'}
    </span>`)}
  `);
}

interface ConsultEmailParams {
  clientName:      string;
  mentorName:      string;
  reference:       string;
  lang:            'en' | 'fr';
  /** ISO datetime set by admin when approving. */
  scheduledAt?:    string | null;
  /** Duration in minutes (from the booking request or admin). */
  durationMinutes?: number | null;
  /** Estimated fee in DZD after any promo discount. 0 = free. */
  estimatedFee?:   number | null;
  /** Google Meet / Zoom / Teams link provided by admin on approval. */
  meetLink?:       string | null;
  /** True when the session will be in-person (no online link). */
  isOffline?:      boolean;
}

export function consultationConfirmationEmailHtml(params: ConsultEmailParams): string {
  const { clientName, mentorName, reference, lang, scheduledAt, durationMinutes, estimatedFee, meetLink, isOffline } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const bodyText = isFr
    ? `Votre demande de consultation avec <strong>${mentorName}</strong> a été <strong>approuvée</strong>. Vous trouverez les détails ci-dessous ainsi que votre PDF de confirmation en pièce jointe.`
    : `Your consultation request with <strong>${mentorName}</strong> has been <strong>approved</strong>. Please find the details below and your confirmation PDF attached.`;

  const title = isFr ? 'Consultation confirmée ✓' : 'Consultation confirmed ✓';

  // Build optional detail rows
  const schedRow = scheduledAt
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Date confirmée' : 'Confirmed date'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${new Date(scheduledAt).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })}
        </td>
      </tr>`
    : '';

  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Durée' : 'Duration'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${durationMinutes} min
        </td>
      </tr>`
    : '';

  const feeRow = estimatedFee != null
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Frais estimés' : 'Estimated fee'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${estimatedFee === 0 ? (isFr ? 'Gratuit' : 'Free') : `${estimatedFee.toLocaleString('fr-DZ')} DZD`}
        </td>
      </tr>`
    : '';

  const meetRow = meetLink
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Lien de réunion' : 'Meeting link'}
        </td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f4f4f5;font-weight:500;">
          <a href="${meetLink}" style="color:#166534;word-break:break-all;">${meetLink}</a>
        </td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Format' : 'Format'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">
          ${isFr ? 'En présentiel' : 'In-person'}
        </td>
      </tr>`
    : '';

  const joinBlock = meetLink
    ? `<div style="margin:24px 0;text-align:center;">
        ${button(meetLink, isFr ? '📹 Rejoindre la réunion' : '📹 Join the meeting')}
        <p style="margin:10px 0 0;font-size:11px;color:#71717a;word-break:break-all;">${meetLink}</p>
      </div>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(bodyText)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">
          ${isFr ? 'Consultant' : 'Consultant'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${feeRow}
      ${meetRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;border-top:1px solid #f4f4f5;">
          ${isFr ? 'Référence' : 'Reference'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;font-weight:500;border-top:1px solid #f4f4f5;">
          ${reference.slice(0, 8).toUpperCase()}
        </td>
      </tr>
    </table>
    ${joinBlock}
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Votre PDF de confirmation est joint à cet email.'
        : 'Your confirmation PDF is attached to this email.'}
    </span>`)}
  `);
}

/* ── New: guest pay link (approved, awaiting online payment) ── */

interface ConsultPayLinkParams {
  clientName:      string;
  mentorName:      string;
  reference:       string;
  payUrl:          string;
  amount:          number;
  expiresAt:       string;
  lang:            'en' | 'fr';
  scheduledAt?:    string | null;
  durationMinutes?: number | null;
  meetLink?:       string | null;
  isOffline?:      boolean;
}

/**
 * Sent to a GUEST after an admin approves their consultation. Contains the
 * confirmed schedule, the amount, and a single-use pay button. NOT a
 * confirmation — the session is only confirmed once payment succeeds.
 */
export function consultationPayLinkEmailHtml(params: ConsultPayLinkParams): string {
  const { clientName, mentorName, reference, payUrl, amount, expiresAt, lang, scheduledAt, durationMinutes, meetLink, isOffline } = params;
  const isFr = lang === 'fr';

  const fmtDt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(isFr ? 'fr-DZ' : 'en-GB', {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
      });
    } catch { return iso; }
  };
  const fmtAmt = `${amount.toLocaleString('fr-DZ')} DZD`;

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Votre consultation est approuvée — paiement requis' : 'Your consultation is approved — payment required';
  const body     = isFr
    ? `Bonne nouvelle — votre demande de consultation avec <strong>${mentorName}</strong> a été approuvée. Pour confirmer votre créneau, veuillez régler le montant ci-dessous. Votre séance sera confirmée dès réception du paiement.`
    : `Good news — your consultation request with <strong>${mentorName}</strong> has been approved. To lock in your slot, please pay the amount below. Your session is confirmed as soon as payment is received.`;

  const schedRow = scheduledAt
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Date confirmée' : 'Confirmed date'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${fmtDt(scheduledAt)}</td>
      </tr>`
    : '';
  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Durée' : 'Duration'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${durationMinutes} min</td>
      </tr>`
    : '';
  const formatRow = meetLink
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Format' : 'Format'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${isFr ? 'En ligne' : 'Online'}</td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Format' : 'Format'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${isFr ? 'En présentiel' : 'In-person'}</td>
      </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:160px;">${isFr ? 'Consultant' : 'Consultant'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${formatRow}
      <tr style="background:#f4fdf7;">
        <td style="padding:12px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;width:160px;">${isFr ? 'Montant à payer' : 'Amount due'}</td>
        <td style="padding:12px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${fmtAmt}</td>
      </tr>
    </table>
    <div style="margin:24px 0;text-align:center;">
      ${button(payUrl, isFr ? `Payer ${fmtAmt}` : `Pay ${fmtAmt}`)}
      <p style="margin:12px 0 0;font-size:12px;color:#71717a;word-break:break-all;">${payUrl}</p>
    </div>
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr
        ? `Ce lien de paiement sécurisé (CIB / Edahabia) expire le ${fmtDt(expiresAt)}. Référence : `
        : `This secure payment link (CIB / Edahabia) expires on ${fmtDt(expiresAt)}. Reference: `}<code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/* ── New: request received (pending, not yet approved) ── */

interface ConsultRequestParams {
  clientName:       string;
  mentorName:       string;
  reference:        string;
  consultationDate: string | null | undefined;
  consultationTime: string | null | undefined;
  durationMinutes:  number | null | undefined;
  lang:             'en' | 'fr';
}

export function consultationRequestReceivedEmailHtml(params: ConsultRequestParams): string {
  const { clientName, mentorName, reference, consultationDate, consultationTime, durationMinutes, lang } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Demande de consultation reçue' : 'Consultation request received';
  const body     = isFr
    ? `Votre demande de consultation avec <strong>${mentorName}</strong> a bien été reçue et est en attente de validation. Vous serez notifié(e) par email dès qu'elle sera traitée.`
    : `Your consultation request with <strong>${mentorName}</strong> has been received and is pending review. You will be notified by email once it has been processed.`;

  const slotRow = (consultationDate && consultationTime)
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${isFr ? 'Créneau souhaité' : 'Requested slot'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${consultationDate} ${consultationTime}${durationMinutes ? ` · ${durationMinutes} min` : ''}</td>
      </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      ${slotRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">${isFr ? 'Consultant' : 'Consultant'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${mentorName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">${isFr ? 'Référence' : 'Reference'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;font-weight:500;">${reference.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr ? 'Statut : En attente de validation' : 'Status: Pending review'}</span>`)}
  `);
}

/* ── New: rejection email ── */

interface ConsultRejectedParams {
  clientName:  string;
  mentorName:  string;
  adminNote:   string | null;
  lang:        'en' | 'fr';
}

export function consultationRejectedEmailHtml(params: ConsultRejectedParams): string {
  const { clientName, mentorName, adminNote, lang } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const title    = isFr ? 'Demande de consultation refusée' : 'Consultation request declined';
  const body     = isFr
    ? `Nous regrettons de vous informer que votre demande de consultation avec <strong>${mentorName}</strong> n'a pas pu être acceptée pour le moment.`
    : `We regret to inform you that your consultation request with <strong>${mentorName}</strong> could not be accepted at this time.`;
  const noteRow = adminNote
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">${isFr ? 'Motif' : 'Reason'}</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;">${adminNote.replace(/</g, '&lt;')}</td>
       </tr>`
    : '';

  return layout(`
    ${h1(title)}
    ${p(greeting)}
    ${p(body)}
    ${noteRow ? `<table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">${noteRow}</table>` : ''}
    ${p(`<span style="color:#71717a;font-size:13px;">${isFr ? 'Vous pouvez soumettre une nouvelle demande à tout moment.' : 'You may submit a new request at any time.'}</span>`)}
  `);
}

/* ── New: admin notification of new consultation ── */

interface AdminConsultNotifParams {
  userName:         string;
  userEmail:        string;
  userPhone:        string;
  mentorName:       string;
  message:          string;
  bookingId:        string;
  consultationDate: string | null | undefined;
  consultationTime: string | null | undefined;
  durationMinutes:  number | null | undefined;
}

export function adminConsultationNotificationHtml(params: AdminConsultNotifParams): string {
  const { userName, userEmail, userPhone, mentorName, message, bookingId, consultationDate, consultationTime, durationMinutes } = params;

  const slotRow = (consultationDate && consultationTime)
    ? `<tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Créneau</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${consultationDate} ${consultationTime}${durationMinutes ? ` · ${durationMinutes} min` : ''}</td>
      </tr>`
    : '';

  return layout(`
    ${h1('Nouvelle demande de consultation')}
    ${p(`<strong>${userName}</strong> a soumis une demande de consultation avec <strong>${mentorName}</strong>.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Nom</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:500;">${userName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Email</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${userEmail}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Téléphone</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${userPhone}</td>
      </tr>
      ${slotRow}
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">Réf.</td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;">${bookingId.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#3f3f46;line-height:1.7;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>
  `);
}

/* ── Admin: new paid order (space booking / program / event) ── */

export interface AdminOrderNotifParams {
  orderKind:    'SPACE' | 'PROGRAM' | 'EVENT';
  customerName: string;
  customerEmail: string;
  itemName:     string;
  vendorName:   string;
  amount:       number;
  reference:    string;
  paymentMethod: string;
}

export function adminOrderNotificationHtml(params: AdminOrderNotifParams): string {
  const { orderKind, customerName, customerEmail, itemName, vendorName, amount, reference, paymentMethod } = params;
  const kindLabel = orderKind === 'SPACE' ? 'Réservation espace' : orderKind === 'PROGRAM' ? 'Candidature programme' : 'Inscription événement';
  const fmtAmt = amount === 0 ? 'Gratuit' : `${amount.toLocaleString('fr-DZ')} DZD`;

  return layout(`
    ${h1(`[Admin] Nouvelle commande — ${kindLabel}`)}
    ${p(`Un nouveau paiement a été enregistré sur la plateforme.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:160px;border-bottom:1px solid #e4e4e7;">Type</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${kindLabel}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${customerName} &lt;${customerEmail}&gt;</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Prestation</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${itemName}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Fournisseur</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${vendorName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Paiement</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${paymentMethod}</td>
      </tr>
      <tr style="background:#f4fdf7;">
        <td style="padding:12px 16px;font-size:14px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">Montant</td>
        <td style="padding:12px 16px;font-size:16px;color:#166534;font-weight:700;border-top:1px solid #e4e4e7;">${fmtAmt}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:12px;">Référence : <code style="background:#f4f4f5;padding:2px 6px;border-radius:4px;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</code></span>`)}
  `);
}

/* ── Admin: new incubator account ── */

export interface AdminIncubatorNotifParams {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
}

export function adminIncubatorNotificationHtml(params: AdminIncubatorNotifParams): string {
  const { fullName, email, phone, userId, createdAt } = params;
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString('fr-DZ', { dateStyle: 'long', timeStyle: 'short' }); }
    catch { return iso; }
  };

  return layout(`
    ${h1('[Admin] Nouvel incubateur inscrit')}
    ${p(`Un nouveau compte incubateur vient d'être créé et vérifié.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:140px;border-bottom:1px solid #e4e4e7;">Nom</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${fullName}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Email</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${email}</td>
      </tr>
      ${phone ? `<tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Téléphone</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${phone}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Inscrit le</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${fmtDate(createdAt)}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;">ID</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;font-family:monospace;">${userId}</td>
      </tr>
    </table>
    ${p('<span style="color:#71717a;font-size:12px;">Accédez au tableau de bord admin pour gérer ce compte.</span>')}
  `);
}

/* ── Consultant (mentor) notification — session confirmed by admin ── */

export interface MentorSessionConfirmedParams {
  mentorName:      string;
  clientName:      string;
  clientEmail:     string;
  clientPhone:     string;
  scheduledAt:     string | null;
  durationMinutes: number | null | undefined;
  meetLink:        string | null | undefined;
  isOffline:       boolean | undefined;
  adminNote:       string | null | undefined;
  reference:       string;
}

export function mentorSessionConfirmedEmailHtml(params: MentorSessionConfirmedParams): string {
  const { mentorName, clientName, clientEmail, clientPhone, scheduledAt, durationMinutes, meetLink, isOffline, adminNote, reference } = params;

  const fmtDt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  const schedRow = scheduledAt
    ? `<tr style="background:#f0fdf4;">
        <td style="padding:10px 16px;font-size:13px;color:#166534;font-weight:700;width:160px;border-bottom:1px solid #e4e4e7;">Session date</td>
        <td style="padding:10px 16px;font-size:14px;color:#15803d;font-weight:700;border-bottom:1px solid #e4e4e7;">${fmtDt(scheduledAt)}</td>
      </tr>`
    : '';

  const durRow = durationMinutes
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Duration</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${durationMinutes} min</td>
      </tr>`
    : '';

  const formatRow = meetLink
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Meeting link</td>
        <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #e4e4e7;">
          <a href="${meetLink}" style="color:#166534;word-break:break-all;">${meetLink}</a>
        </td>
      </tr>`
    : isOffline
    ? `<tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Format</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">In-person</td>
      </tr>`
    : '';

  const joinBlock = meetLink
    ? `<div style="margin:24px 0;text-align:center;">
        ${button(meetLink, '📹 Join the session')}
        <p style="margin:10px 0 0;font-size:11px;color:#71717a;word-break:break-all;">${meetLink}</p>
      </div>`
    : '';

  const noteBlock = adminNote
    ? `<div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:14px 18px;margin:20px 0;">
        <p style="margin:0;font-size:13px;color:#713f12;"><strong>Note:</strong> ${adminNote.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
      </div>`
    : '';

  return layout(`
    ${h1('Consultation session confirmed ✅')}
    ${p(`Hi <strong>${mentorName}</strong>, a consultation session with a client has been approved and is now confirmed.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:160px;border-bottom:1px solid #e4e4e7;">Client name</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${clientName}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client email</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">
          <a href="mailto:${clientEmail}" style="color:#166534;">${clientEmail}</a>
        </td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #e4e4e7;">Client phone</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #e4e4e7;">${clientPhone}</td>
      </tr>
      ${schedRow}
      ${durRow}
      ${formatRow}
      <tr style="background:#f9fafb;">
        <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;">Reference</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;font-family:monospace;">${reference.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    ${joinBlock}
    ${noteBlock}
    ${p('<span style="color:#71717a;font-size:13px;">Please be ready 5 minutes before the session starts. The client has received the same meeting details.</span>')}
  `);
}

/* ─────────────────────────── Network Pass / Credits ──────────────────── */

export interface CreditLowWarningEmailParams {
  fullName: string;
  email: string;
  creditsRemaining: number;
  tier: 'BUILDER' | 'FOUNDER';
  resetDate: Date;
  upgradeUrl: string;
}

export function creditLowWarningEmailHtml(params: CreditLowWarningEmailParams): string {
  const { fullName, creditsRemaining, tier, resetDate, upgradeUrl } = params;
  const fmtDate = (d: Date) => {
    try { return d.toLocaleDateString('en-DZ', { dateStyle: 'long' }); }
    catch { return d.toISOString().slice(0, 10); }
  };
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';
  const upgradeNote = tier === 'BUILDER'
    ? `<p style="margin:16px 0;font-size:15px;color:#374151;">Upgrade to <strong>Founder</strong> to get <strong>10 credits</strong> every month.</p>`
    : '';

  return layout(`
    ${h1('Your network credits are running low')}
    ${p(`Hi <strong>${fullName}</strong>, you only have <strong>${creditsRemaining} network pass credit${creditsRemaining !== 1 ? 's' : ''}</strong> left this month as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:20px 0;background:#fffbeb;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#92400e;">
          ⚡ Your credits reset on <strong>${fmtDate(resetDate)}</strong>. Use them before they expire!
        </td>
      </tr>
    </table>
    ${upgradeNote}
    ${upgradeNote ? `<p style="margin:0 0 16px;"><a href="${upgradeUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Upgrade to Founder</a></p>` : ''}
    ${p('<span style="color:#71717a;font-size:13px;">Network Pass credits expire at the end of the month and do not carry over.</span>')}
  `);
}

export interface CreditExpiryReminderEmailParams {
  fullName: string;
  email: string;
  creditsRemaining: number;
  tier: 'BUILDER' | 'FOUNDER';
  spacesUrl: string;
}

export function creditExpiryReminderEmailHtml(params: CreditExpiryReminderEmailParams): string {
  const { fullName, creditsRemaining, tier, spacesUrl } = params;
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';

  return layout(`
    ${h1('Last day to use your network credits!')}
    ${p(`Hi <strong>${fullName}</strong>, today is the <strong>last day of the month</strong> and you still have <strong>${creditsRemaining} credit${creditsRemaining !== 1 ? 's' : ''}</strong> remaining as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fca5a5;border-radius:8px;overflow:hidden;margin:20px 0;background:#fef2f2;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#991b1b;">
          🕐 Unused credits expire at midnight UTC tonight and <strong>cannot be carried over</strong>.
        </td>
      </tr>
    </table>
    ${p('Book a coworking space or office at a partner location today to make the most of your membership.')}
    <p style="margin:0 0 16px;"><a href="${spacesUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Find a Partner Space</a></p>
    ${p('<span style="color:#71717a;font-size:13px;">Your credits will reset tomorrow with a fresh allowance for the new month.</span>')}
  `);
}

export interface MonthlyCreditsResetEmailParams {
  fullName: string;
  email: string;
  newCredits: number;
  tier: 'BUILDER' | 'FOUNDER';
  spacesUrl: string;
}

export function monthlyCreditsResetEmailHtml(params: MonthlyCreditsResetEmailParams): string {
  const { fullName, newCredits, tier, spacesUrl } = params;
  const tierLabel = tier === 'FOUNDER' ? 'Founder' : 'Builder';

  return layout(`
    ${h1('Your network credits have been refreshed!')}
    ${p(`Hi <strong>${fullName}</strong>, your monthly network pass credits have been reset. You now have <strong>${newCredits} credit${newCredits !== 1 ? 's' : ''}</strong> available as a ${tierLabel} member.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #bbf7d0;border-radius:8px;overflow:hidden;margin:20px 0;background:#f0fdf4;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#166534;">
          ✅ <strong>${newCredits}</strong> network pass credit${newCredits !== 1 ? 's' : ''} — valid until the last day of this month.
        </td>
      </tr>
    </table>
    ${p('Use your credits to book coworking spaces and offices at any Metwork partner location.')}
    <p style="margin:0 0 16px;"><a href="${spacesUrl}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Browse Partner Spaces</a></p>
  `);
}

/* ─────────────── Network Pass Check-in (booking confirmation) ────────── */

export interface NetworkPassCheckInEmailParams {
  customerName: string;
  bookingId: string;
  spaceName: string;
  city: string;
  bookingDate: string;     // ISO datetime
  startsAt: string;        // ISO datetime
  endsAt: string;          // ISO datetime
  /** Plaintext code, e.g. "MNP-2026-00145" — shown to user only here. */
  code: string;
  /** "data:image/png;base64,…" — base64-encoded QR PNG. */
  qrCodeDataUrl: string;
  /** ISO datetime — 23:59:59 UTC on the booking day. */
  expiresAt: string;
}

/**
 * Sent to the user when a Network Pass booking is confirmed. Contains the
 * QR code + plaintext check-in code (shown only ONCE — never retrievable
 * from the DB).
 */
export function networkPassCheckInEmailHtml(opts: NetworkPassCheckInEmailParams): string {
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' }); }
    catch { return iso.slice(0, 10); }
  };
  const fmtTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };
  const fmtExpiry = (iso: string) => {
    try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }); }
    catch { return iso; }
  };

  return layout(`
    ${h1('Your Network Pass is ready')}
    ${p(`Hi <strong>${opts.customerName}</strong>, your coworking session is booked. Show this QR or read out the code at reception.`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:2px solid #16a34a;border-radius:12px;overflow:hidden;margin:20px 0;background:#f0fdf4;">
      <tr>
        <td style="padding:24px;text-align:center;">
          <div style="font-size:13px;color:#166534;font-weight:600;letter-spacing:0.5px;margin-bottom:12px;">🎫 NETWORK PASS CHECK-IN</div>
          <img src="${opts.qrCodeDataUrl}" width="220" height="220" alt="Network Pass QR Code" style="border-radius:8px;border:1px solid #bbf7d0;background:#ffffff;" />
          <div style="margin-top:16px;font-size:13px;color:#166534;">Your Check-in Code</div>
          <div style="margin-top:4px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:24px;color:#09090b;font-weight:700;letter-spacing:1px;">${opts.code}</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:20px 0;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;width:40%;">Space</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;font-weight:500;">${opts.spaceName}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">City</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${opts.city}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${fmtDate(opts.bookingDate)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#71717a;font-weight:600;border-top:1px solid #e4e4e7;">Time</td>
        <td style="padding:12px 16px;font-size:14px;color:#09090b;border-top:1px solid #e4e4e7;">${fmtTime(opts.startsAt)} – ${fmtTime(opts.endsAt)}</td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin:20px 0;background:#fffbeb;">
      <tr>
        <td style="padding:16px 20px;font-size:14px;color:#92400e;">
          ⏰ <strong>Expires:</strong> ${fmtExpiry(opts.expiresAt)} — single use only.
        </td>
      </tr>
    </table>
    ${p('<span style="color:#71717a;font-size:13px;">Lost the code? Visit your bookings page in the Metwork dashboard to view it again.</span>')}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner promo code invite email
// ─────────────────────────────────────────────────────────────────────────────

export interface PartnerPromoCodeEmailParams {
  /** Recipient's name or email address (used in the greeting). */
  recipientName: string;
  /** Name of the partner space issuing the code. */
  partnerName: string;
  /** The plaintext promo code — e.g. "PPT-ORAN-2026-X7K3M2". */
  promoCode: string;
  /** 'BUILDER' or 'FOUNDER' — shown to the user. */
  membershipTier: 'BUILDER' | 'FOUNDER';
  /** Discount percentage (integer 1–99). */
  discountPercentage: number;
  /** Expiry date in ISO YYYY-MM-DD format. */
  validUntil: string;
  /** Redemption URL — links to the membership checkout page. */
  redeemUrl: string;
}

export function partnerPromoCodeEmailHtml(params: PartnerPromoCodeEmailParams): string {
  const {
    recipientName,
    partnerName,
    promoCode,
    membershipTier,
    discountPercentage,
    validUntil,
    redeemUrl,
  } = params;

  const tierLabel = membershipTier === 'FOUNDER' ? 'Founder' : 'Builder';
  const expiryFormatted = new Date(validUntil).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return layout(`
    ${h1(`You have a ${discountPercentage}% membership discount! 🎉`)}
    ${p(`Hi <strong>${recipientName}</strong>, <strong>${partnerName}</strong> has invited you to join Metwork&apos;s <strong>${tierLabel}</strong> membership tier at a ${discountPercentage}% discount.`)}
    ${p('Use the exclusive code below when you upgrade your membership:')}
    <div style="text-align:center;margin:32px 0;">
      <span style="display:inline-block;padding:16px 36px;background:#f0fdf4;border:2px dashed #166534;border-radius:12px;font-size:28px;font-weight:700;letter-spacing:6px;color:#166534;font-family:monospace;">${promoCode}</span>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin:0 0 24px;">
      <tr style="background:#f9fafb;">
        <td colspan="2" style="padding:12px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#71717a;border-bottom:1px solid #e4e4e7;">
          Discount details
        </td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;width:140px;">Membership tier</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;font-weight:600;">${tierLabel}</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;border-bottom:1px solid #f4f4f5;">Discount</td>
        <td style="padding:10px 16px;font-size:13px;color:#166534;border-bottom:1px solid #f4f4f5;font-weight:600;">${discountPercentage}% off</td>
      </tr>
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#71717a;">Valid until</td>
        <td style="padding:10px 16px;font-size:13px;color:#09090b;font-weight:600;">${expiryFormatted}</td>
      </tr>
    </table>
    ${button(redeemUrl, 'Redeem your discount')}
    ${p('<span style="color:#71717a;font-size:13px;">This code is single-use and cannot be transferred. Once redeemed your discounted membership will be activated immediately for one year.</span>')}
    ${p(`<span style="color:#71717a;font-size:13px;">If you did not expect this email or have questions, please contact your space administrator at <strong>${partnerName}</strong>.</span>`)}
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership welcome email (tier-specific)
// ─────────────────────────────────────────────────────────────────────────────

export interface MembershipWelcomeEmailParams {
  /** Recipient's full name. */
  fullName: string;
  /** 'BUILDER' or 'FOUNDER'. */
  membershipTier: 'BUILDER' | 'FOUNDER';
  /** Monthly credits allocated (3 for Builder, 10 for Founder). */
  monthlyCredits: number;
  /** ISO expiry date. */
  expiresAt: string;
  /** URL to the membership dashboard. */
  dashboardUrl: string;
}

/**
 * Tier-themed welcome email sent when a user activates a Builder or Founder
 * membership (direct purchase or via a partner promo code).
 *
 * Subject line should be set by the caller:
 *   Builder → "🏆 Welcome to Metwork Builder membership!"
 *   Founder → "👑 Welcome to Metwork Founder membership!"
 */
export function membershipWelcomeEmailHtml(params: MembershipWelcomeEmailParams): string {
  const { fullName, membershipTier, monthlyCredits, expiresAt, dashboardUrl } = params;

  const isFounder = membershipTier === 'FOUNDER';
  const tierLabel = isFounder ? 'Founder' : 'Builder';
  const tierIcon  = isFounder ? '👑' : '🏆';

  // Tier-specific accent colors (inline — email clients don't support CSS vars)
  const accentColor    = isFounder ? '#9D9B99' : '#D4AF37';
  const accentBg       = isFounder ? '#F5F4F2' : '#FAF6F0';
  const accentBorder   = isFounder ? '#E5E4E2' : '#E8D9B5';
  const accentText     = isFounder ? '#4A4845' : '#6B5218';

  const expiryFormatted = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const benefits = isFounder
    ? [
        `${monthlyCredits} coworking sessions / month`,
        'Access to all 30+ partner spaces',
        'Featured startup listing',
        'Priority mentor sessions (3 / month)',
        'Investor meeting requests',
        'Dedicated support',
      ]
    : [
        `${monthlyCredits} coworking sessions / month`,
        'Access to all partner spaces',
        'Book spaces & programs',
        'Priority mentor session (1 / month)',
        'Events at discounted rate',
      ];

  const benefitRows = benefits
    .map(
      (b) =>
        `<tr><td style="padding:6px 0;font-size:14px;color:#3f3f46;line-height:1.5;">
          <span style="color:${accentColor};margin-right:8px;">✓</span>${b}
        </td></tr>`,
    )
    .join('');

  return layout(`
    ${h1(`${tierIcon} Welcome to Metwork ${tierLabel}!`)}
    ${p(`Hi <strong>${fullName}</strong> — your <strong>${tierLabel}</strong> membership is now active. Here's everything you have access to:`)}
    <table width="100%" cellpadding="0" cellspacing="0"
           style="border:1.5px solid ${accentBorder};border-radius:12px;overflow:hidden;margin:20px 0;background:${accentBg};">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid ${accentBorder};">
          <span style="font-size:20px;font-weight:700;color:${accentColor};">${tierIcon} ${tierLabel} Member</span>
          <p style="margin:4px 0 0;font-size:13px;color:${accentText};">Valid until ${expiryFormatted}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${accentText};">
            Your benefits
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${benefitRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:12px 20px;background:${accentBorder}30;border-top:1px solid ${accentBorder};">
          <p style="margin:0;font-size:13px;color:${accentText};">
            <strong>${monthlyCredits} network credits</strong> reset on the 1st of each month.
          </p>
        </td>
      </tr>
    </table>
    ${button(dashboardUrl, 'Go to your dashboard')}
    ${p('<span style="color:#71717a;font-size:13px;">Credits are non-transferable and do not roll over. Questions? Reply to this email.</span>')}
  `);
}
