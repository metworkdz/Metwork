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
  clientName: string;
  mentorName: string;
  reference:  string;
  lang:       'en' | 'fr';
}

export function consultationConfirmationEmailHtml(params: ConsultEmailParams): string {
  const { clientName, mentorName, reference, lang } = params;
  const isFr = lang === 'fr';

  const greeting = isFr ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const bodyText = isFr
    ? `Votre demande de consultation avec <strong>${mentorName}</strong> a bien été enregistrée. Notre équipe vous contactera prochainement pour confirmer l'heure et la date du rendez-vous.`
    : `Your consultation request with <strong>${mentorName}</strong> has been received. Our team will contact you shortly to confirm the time and date of the meeting.`;

  const title = isFr ? 'Demande de consultation confirmée' : 'Consultation request confirmed';

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
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#71717a;width:140px;">
          ${isFr ? 'Référence' : 'Reference'}
        </td>
        <td style="padding:8px 12px;font-size:13px;color:#09090b;font-weight:500;">${reference.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>
    ${p(`<span style="color:#71717a;font-size:13px;">
      ${isFr
        ? 'Veuillez trouver ci-joint votre confirmation de demande en PDF.'
        : 'Please find your request confirmation PDF attached.'}
    </span>`)}
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
