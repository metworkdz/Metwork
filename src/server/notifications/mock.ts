/**
 * Notification dispatcher.
 *
 * Routes each notification to the appropriate real provider when
 * credentials are present, otherwise falls back to console.log so
 * local development never requires live keys.
 *
 * All exported functions are fire-and-forget (void) — callers are
 * unchanged.  Async errors are caught and logged so they never bubble
 * up and crash the request.
 */

import { recordE2eEmail } from './e2e-email-sink';
import { sendWhatsAppOTP, sendSMSOTP, sendSMSMessage, sendWhatsAppMessage, sendWhatsAppNewBookingTemplate } from './sms';
import {
  sendResendEmail,
  otpEmailHtml,
  welcomeEmailHtml,
  verificationEmailHtml,
  passwordResetEmailHtml,
  consultationReadyEmailHtml,
  consultantNewBookingEmailHtml,
  consultantSessionReminderEmailHtml,
  contactNotificationHtml,
  bookingReceiptEmailHtml,
  bookingConfirmedWithQrEmailHtml,
  bookingDeclinedEmailHtml,
  bookingCancelledUnpaidEmailHtml,
  bookingUpdatedEmailHtml,
  bookingProviderCancelledEmailHtml,
  withdrawalRequestedEmailHtml,
  withdrawalProcessedEmailHtml,
  withdrawalApprovedEmailHtml,
  consultationConfirmationEmailHtml,
  consultationPayLinkEmailHtml,
  consultationRequestReceivedEmailHtml,
  consultationRejectedEmailHtml,
  adminConsultationNotificationHtml,
  adminOrderNotificationHtml,
  adminIncubatorNotificationHtml,
  adminInvestorNotificationHtml,
  mentorSessionConfirmedEmailHtml,
  paymentLinkReceiptEmailHtml,
  paymentLinkPaidEmailHtml,
  bookingRequestReceivedEmailHtml,
  incubatorBookingRequestEmailHtml,
  bookingApprovedPayEmailHtml,
  bookingPaidIncubatorEmailHtml,
  type AdminOrderNotifParams,
  type EmailLang,
} from './email';
import {
  generateBookingReceiptPdf,
  generateMentorConfirmationPdf,
  generatePaymentLinkReceiptPdf,
  type BookingReceiptInput,
  type MentorConfirmationInput,
} from './receipt';
import type { IncubatorRecord, PaymentLinkRecord } from '@/server/db/store';

const banner = '\x1b[36m[notify]\x1b[0m';

/* ─────────────────────────── WhatsApp / SMS ─────────────────────────── */

/**
 * Send OTP via WhatsApp (Infobip primary channel).
 * Falls back to console.log when INFOBIP_* vars are not set.
 * Returns the send promise (self-catching, never rejects) so serverless
 * callers can await actual delivery before the lambda freezes.
 */
export function sendOtpWhatsApp(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP → ${phone} :: code = ${code}`);
  }

  if (process.env.SMS_PROVIDER === 'infobip') {
    return sendWhatsAppOTP(phone, code).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Infobip WhatsApp failed →`, err.message),
    );
  }

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP (mock) → ${phone} :: code = ${code}`);
  }
  return Promise.resolve();
}

/**
 * Send OTP via SMS (Infobip fallback channel). Returns the self-catching send
 * promise — see sendOtpWhatsApp.
 */
export function sendOtpSms(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} SMS → ${phone} :: code = ${code}`);
  }

  if (process.env.SMS_PROVIDER === 'infobip') {
    return sendSMSOTP(phone, code).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Infobip SMS failed →`, err.message),
    );
  }

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} SMS (mock) → ${phone} :: code = ${code}`);
  }
  return Promise.resolve();
}

/**
 * Send OTP via email (Resend).  Used as a reliable fallback when SMS
 * cannot be trusted (carrier geo-filtering, test environments, etc.).
 * Falls back to console.log when Resend is not configured. Returns the
 * self-catching send promise — see sendOtpWhatsApp.
 */
export function sendOtpEmail(email: string, code: string): Promise<void> {
  return sendResendEmail({
    to: email,
    subject: `${code} is your Metwork verification code`,
    html: otpEmailHtml(code),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (otp) → ${email} :: code = ${code}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend OTP email failed →`, err.message),
    );
}

/**
 * Canonical consultant sign-in OTP delivery — the ONE place consultant
 * signup and email→OTP sign-in route their code through, so both stay in sync.
 *
 * Fires every available channel best-effort (email deliverability in Algeria
 * is unreliable, so a single channel isn't enough): WhatsApp (primary, via the
 * approved template) and SMS when a phone is on record, plus email always.
 * Each channel is independent and self-logs its own failure — one dead channel
 * never blocks the others, and the code always reaches at least one.
 *
 * AWAITABLE — and the consultant routes DO await it: on Vercel the lambda
 * freezes once the response is sent, so unawaited sends silently die.
 */
export async function sendConsultantOtp(opts: { email?: string | null; phone?: string | null; code: string }): Promise<void> {
  const sends: Array<Promise<unknown>> = [];
  const phone = opts.phone?.trim();
  if (phone) {
    // WhatsApp is the reliable channel for Algerian numbers; SMS backs it up.
    sends.push(sendOtpWhatsApp(phone, opts.code));
    sends.push(sendOtpSms(phone, opts.code));
  }
  const email = opts.email?.trim();
  if (email) sends.push(sendOtpEmail(email, opts.code));
  await Promise.allSettled(sends);
}

/* ─────────────────────────── Email ─────────────────────────── */

export function sendWelcomeEmail(opts: {
  email: string;
  fullName: string;
  role: string;
  dashboardUrl: string;
}): void {
  sendResendEmail({
    to: opts.email,
    subject: `Welcome to Metwork, ${opts.fullName}!`,
    html: welcomeEmailHtml({
      fullName: opts.fullName,
      role: opts.role,
      dashboardUrl: opts.dashboardUrl,
    }),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (welcome) → ${opts.email}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend welcome email failed →`, err.message),
    );
}

export function sendVerificationEmail(email: string, link: string): void {
  sendResendEmail({
    to: email,
    subject: 'Verify your Metwork email address',
    html: verificationEmailHtml(link),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL → ${email} :: Verify your address → ${link}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend email failed →`, err.message),
    );
}

export function sendPasswordResetEmail(email: string, link: string): void {
  sendResendEmail({
    to: email,
    subject: 'Reset your Metwork password',
    html: passwordResetEmailHtml(link),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL → ${email} :: Reset your password → ${link}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend email failed →`, err.message),
    );
}

/**
 * Deliver a client-facing text on the phone: WhatsApp first, cascading to
 * plain SMS when WhatsApp is rejected (business-initiated free-form WhatsApp
 * only delivers inside a 24h service window the client rarely has open; SMS
 * has no template restriction). Self-catching — never throws. AWAITABLE so
 * serverless routes can hold the response until the send actually happened.
 */
function deliverClientText(phone: string, text: string, tag: string): Promise<void> {
  if (process.env.SMS_PROVIDER !== 'infobip') {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP (${tag}) → ${phone} :: ${text.slice(0, 80)}…`);
    return Promise.resolve();
  }
  return sendWhatsAppMessage(phone, text).catch((waErr: Error) => {
    // eslint-disable-next-line no-console
    console.error(`${banner} WhatsApp ${tag} failed → ${waErr.message} — falling back to SMS`);
    return sendSMSMessage(phone, text).catch((smsErr: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} SMS ${tag} fallback failed →`, smsErr.message),
    );
  });
}

/** Human meeting-details block for client phone texts (link or address). */
function meetingDetailsText(booking: MentorConfirmationInput['booking'], isFr: boolean): string {
  return booking.meetingMode === 'ONLINE' && booking.meetingLink
    ? `\n${isFr ? 'Lien' : 'Link'}: ${booking.meetingLink}`
    : booking.meetingMode === 'OFFLINE'
    ? `\n${isFr ? 'Format : en présentiel' : 'Format: in person'}` +
      (booking.meetingAddress ? `\n${isFr ? 'Adresse' : 'Address'}: ${booking.meetingAddress}` : '') +
      (booking.meetingMapsLink ? `\nGoogle Maps: ${booking.meetingMapsLink}` : '')
    : '';
}

/**
 * Tell the client their paid consultation is READY (meeting format confirmed).
 * Email + WhatsApp→SMS cascade. Dedup is handled by the caller
 * (sendConsultationReadyOnce claims `linkSentAt`).
 *
 * AWAITABLE (and awaited by the once-sender): on Vercel the lambda freezes as
 * soon as the response is sent, killing fire-and-forget promises — awaiting is
 * what guarantees the client actually gets the email. Never throws.
 */
export async function sendConsultationReadyEmail(input: MentorConfirmationInput): Promise<void> {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';

  const emailSend = sendResendEmail({
    to: booking.userEmail,
    subject: isFr
      ? `Votre consultation est prête — ${mentor.fullName}`
      : `Your consultation is ready — ${mentor.fullName}`,
    html: consultationReadyEmailHtml({
      clientName: booking.userName,
      mentorName: mentor.fullName,
      meetingMode: booking.meetingMode ?? null,
      meetingLink: booking.meetingLink ?? null,
      meetingAddress: booking.meetingAddress ?? null,
      meetingMapsLink: booking.meetingMapsLink ?? null,
      scheduledAt: booking.scheduledAt ?? null,
      durationMinutes: booking.durationMinutes ?? null,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT READY (no Resend) → ${booking.userEmail} :: mentor=${mentor.fullName}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT READY sent → ${booking.userEmail}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation ready email failed →`, err.message),
    );

  const waText =
    (isFr ? '✅ Metwork — Consultation prête\n' : '✅ Metwork — Consultation ready\n') +
    `${isFr ? 'Consultant' : 'Consultant'}: ${mentor.fullName}` +
    meetingDetailsText(booking, isFr);
  const phoneSend = booking.userPhone
    ? deliverClientText(booking.userPhone, waText, 'consult-ready')
    : Promise.resolve();

  await Promise.allSettled([emailSend, phoneSend]);
}

/** Split a booking's schedule into a localized date + time pair (fallback '—'). */
function bookingDateParts(
  booking: MentorConfirmationInput['booking'],
  isFr: boolean,
): { date: string; time: string } {
  const loc = isFr ? 'fr-DZ' : 'en-GB';
  if (booking.scheduledAt) {
    const d = new Date(booking.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' }),
        time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
      };
    }
  }
  return { date: booking.consultationDate || '—', time: booking.consultationTime || '—' };
}

/**
 * Notify the CONSULTANT of a new confirmed booking — email (always, if the
 * mentor has an address) + WhatsApp (best-effort, via the approved
 * `consultation_new_booking` template, only when a phone is on file). NO client
 * PII in either channel. Both fire-and-forget; dedup is the caller's job
 * (sendBookingNotificationOnce claims `bookingNotifiedAt`). Defaults to French.
 */
export async function sendConsultantNewBookingEmail(input: {
  booking: MentorConfirmationInput['booking'];
  mentor: MentorConfirmationInput['mentor'];
  portalUrl: string;
  lang?: 'en' | 'fr';
}): Promise<void> {
  const { booking, mentor, portalUrl } = input;
  const lang = input.lang ?? 'fr';
  const isFr = lang === 'fr';
  const meetingMode = booking.meetingMode ?? null;
  const sends: Array<Promise<unknown>> = [];

  // ── Email (skipped silently when the mentor has no email on file) ──────────
  if (mentor.email) {
    sends.push(sendResendEmail({
      to: mentor.email,
      subject: isFr ? 'Nouvelle consultation réservée — Metwork' : 'New consultation booked — Metwork',
      html: consultantNewBookingEmailHtml({
        consultantName: mentor.fullName,
        when: bookingWhen(booking) || null,
        durationMinutes: booking.durationMinutes ?? null,
        meetingMode,
        portalUrl,
        lang,
      }),
    })
      .then((sent) => {
        if (!sent)
          // eslint-disable-next-line no-console
          console.log(`${banner} CONSULT NEW BOOKING (no Resend) → ${mentor.email} :: booking=${booking.id.slice(0, 8)}`);
        else
          // eslint-disable-next-line no-console
          console.log(`${banner} CONSULT NEW BOOKING sent → ${mentor.email}`);
      })
      .catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} Consultant new-booking email failed →`, err.message),
      ));
  } else {
    // eslint-disable-next-line no-console
    console.log(`${banner} CONSULT NEW BOOKING email skipped — no email on mentor record (id=${mentor.id})`);
  }

  // ── WhatsApp (best-effort UTILITY template) ────────────────────────────────
  if (mentor.phone) {
    const { date, time } = bookingDateParts(booking, true /* template is French */);
    const firstName = mentor.fullName.trim().split(/\s+/)[0] || mentor.fullName;
    const duration = booking.durationMinutes ? `${booking.durationMinutes} min` : '—';
    const type = meetingMode === 'ONLINE' ? 'En ligne' : meetingMode === 'OFFLINE' ? 'En présentiel' : '—';
    // Fills the template's URL button → https://metwork.dz/c/{bookingRef}. Required.
    const bookingRef = booking.id;
    if (process.env.SMS_PROVIDER === 'infobip') {
      sends.push(sendWhatsAppNewBookingTemplate(mentor.phone, { firstName, date, time, duration, type, bookingRef }).catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} WhatsApp new-booking template failed →`, err.message),
      ));
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} WHATSAPP (new-booking) → ${mentor.phone} :: ${firstName} ${date} ${time} ${duration} ${type} ref=${bookingRef}`);
    }
  }

  await Promise.allSettled(sends);
}

/**
 * Pre-session reminder to the CONSULTANT — the meeting details (or an "add
 * your link" warning for AWAITING_LINK bookings) as the session approaches.
 * Awaitable & self-catching; dedup is the caller's job (the
 * consultation-reminders cron claims `consultantReminderSentAt`). Defaults to
 * French like every other consultant notice.
 */
export async function sendConsultantSessionReminderEmail(input: {
  booking: MentorConfirmationInput['booking'];
  mentor: MentorConfirmationInput['mentor'];
  portalUrl: string;
  lang?: 'en' | 'fr';
}): Promise<void> {
  const { booking, mentor, portalUrl } = input;
  const lang = input.lang ?? 'fr';
  const isFr = lang === 'fr';

  if (!mentor.email) {
    // eslint-disable-next-line no-console
    console.log(`${banner} CONSULT REMINDER skipped — no email on mentor record (id=${mentor.id})`);
    return;
  }

  await sendResendEmail({
    to: mentor.email,
    subject: isFr
      ? 'Rappel — votre consultation approche — Metwork'
      : 'Reminder — your consultation is coming up — Metwork',
    html: consultantSessionReminderEmailHtml({
      consultantName: mentor.fullName,
      when: bookingWhen(booking) || null,
      durationMinutes: booking.durationMinutes ?? null,
      meetingMode: booking.meetingMode ?? null,
      meetingLink: booking.meetingLink ?? null,
      meetingAddress: booking.meetingAddress ?? null,
      awaitingLink: booking.status === 'AWAITING_LINK',
      portalUrl,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REMINDER (no Resend) → ${mentor.email} :: booking=${booking.id.slice(0, 8)}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REMINDER sent → ${mentor.email} :: booking=${booking.id.slice(0, 8)}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultant session-reminder email failed →`, err.message),
    );
}

/**
 * Pre-session reminder to the CLIENT — 1h before the session, with the meeting
 * link / address. Email + WhatsApp→SMS cascade, awaitable & self-catching;
 * dedup is the caller's job (the cron claims `clientReminderSentAt`). Language
 * follows the booking locale like every other client notice.
 */
export async function sendClientSessionReminderEmail(input: MentorConfirmationInput): Promise<void> {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';
  const { date, time } = bookingDateParts(booking, isFr);

  const emailSend = sendResendEmail({
    to: booking.userEmail,
    subject: isFr
      ? `Rappel — votre consultation avec ${mentor.fullName} commence bientôt`
      : `Reminder — your consultation with ${mentor.fullName} starts soon`,
    html: consultationReadyEmailHtml({
      clientName: booking.userName,
      mentorName: mentor.fullName,
      meetingMode: booking.meetingMode ?? null,
      meetingLink: booking.meetingLink ?? null,
      meetingAddress: booking.meetingAddress ?? null,
      meetingMapsLink: booking.meetingMapsLink ?? null,
      scheduledAt: booking.scheduledAt ?? null,
      durationMinutes: booking.durationMinutes ?? null,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CLIENT REMINDER (no Resend) → ${booking.userEmail} :: booking=${booking.id.slice(0, 8)}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CLIENT REMINDER sent → ${booking.userEmail} :: booking=${booking.id.slice(0, 8)}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Client session-reminder email failed →`, err.message),
    );

  const waText =
    (isFr ? '⏰ Metwork — Rappel : votre consultation commence bientôt\n' : '⏰ Metwork — Reminder: your consultation starts soon\n') +
    `${isFr ? 'Consultant' : 'Consultant'}: ${mentor.fullName}` +
    (date !== '—' ? `\n${isFr ? 'Date' : 'Date'}: ${date} ${time !== '—' ? time : ''}`.trimEnd() : '') +
    meetingDetailsText(booking, isFr);
  const phoneSend = booking.userPhone
    ? deliverClientText(booking.userPhone, waText, 'client-reminder')
    : Promise.resolve();

  await Promise.allSettled([emailSend, phoneSend]);
}

/** Minimal branded HTML wrapper for the lightweight P3 lifecycle notices. */
function simpleNoticeHtml(title: string, lines: string[]): string {
  const body = lines.map((l) => `<p style="margin:0 0 10px;color:#3f3f46;font-size:14px;">${l}</p>`).join('');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 16px;color:#18181b;font-size:18px;">${title}</h2>${body}
    <p style="margin:18px 0 0;color:#a1a1aa;font-size:12px;">Metwork</p></div>`;
}

/** Human "when" string from a booking's scheduled time / date+time. */
function bookingWhen(booking: MentorConfirmationInput['booking']): string {
  if (booking.scheduledAt) {
    const d = new Date(booking.scheduledAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 16).replace('T', ' ');
  }
  if (booking.consultationDate) {
    return `${booking.consultationDate}${booking.consultationTime ? ` ${booking.consultationTime}` : ''}`;
  }
  return '';
}

/**
 * Notify the OTHER party that a consultation was rescheduled. `to` is the
 * recipient side ('user' when the consultant moved it, 'consultant' when the
 * user did). Fire-and-forget; never throws into the caller.
 */
export function sendConsultationRescheduledEmail(
  input: MentorConfirmationInput & { to: 'user' | 'consultant' },
): void {
  const { booking, mentor, lang, to } = input;
  const isFr = lang === 'fr';
  const recipientEmail = to === 'consultant' ? (mentor.email ?? '') : booking.userEmail;
  const recipientName = to === 'consultant' ? mentor.fullName : booking.userName;
  if (!recipientEmail) return;
  const when = bookingWhen(booking);

  const subject = isFr
    ? `Consultation reprogrammée — ${mentor.fullName}`
    : `Consultation rescheduled — ${mentor.fullName}`;
  const html = simpleNoticeHtml(subject, [
    isFr ? `Bonjour ${recipientName},` : `Hello ${recipientName},`,
    isFr
      ? `La consultation avec ${to === 'consultant' ? booking.userName : mentor.fullName} a été reprogrammée${when ? ` au <strong>${when}</strong>` : ''}.`
      : `Your consultation with ${to === 'consultant' ? booking.userName : mentor.fullName} has been rescheduled${when ? ` to <strong>${when}</strong>` : ''}.`,
  ]);

  sendResendEmail({ to: recipientEmail, subject, html })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT RESCHEDULED (no Resend) → ${recipientEmail} :: when=${when}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation rescheduled email failed →`, err.message),
    );

  // WhatsApp nudge to the client only.
  if (to === 'user' && booking.userPhone) {
    const waText =
      (isFr ? '🔁 Metwork — Consultation reprogrammée\n' : '🔁 Metwork — Consultation rescheduled\n') +
      `${mentor.fullName}${when ? ` — ${when}` : ''}`;
    if (process.env.SMS_PROVIDER === 'infobip') {
      sendWhatsAppMessage(booking.userPhone, waText).catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} WhatsApp reschedule failed →`, err.message),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} WHATSAPP (reschedule) → ${booking.userPhone} :: ${waText.slice(0, 80)}…`);
    }
  }
}

/**
 * Notify the client that the consultant CANCELLED their consultation and the
 * full amount was refunded to their Metwork wallet. Fire-and-forget.
 */
export function sendConsultationCancelledEmail(
  input: MentorConfirmationInput & { refundedAmount: number },
): void {
  const { booking, mentor, lang, refundedAmount } = input;
  const isFr = lang === 'fr';
  if (!booking.userEmail) return;

  const subject = isFr
    ? `Consultation annulée — ${mentor.fullName}`
    : `Consultation cancelled — ${mentor.fullName}`;
  const refundLine =
    refundedAmount > 0
      ? isFr
        ? `Un remboursement de <strong>${refundedAmount.toLocaleString()} DZD</strong> a été crédité sur votre portefeuille Metwork.`
        : `A refund of <strong>${refundedAmount.toLocaleString()} DZD</strong> has been credited to your Metwork wallet.`
      : isFr
        ? `Aucun paiement n'était dû pour cette consultation.`
        : `No payment was due for this consultation.`;
  const html = simpleNoticeHtml(subject, [
    isFr ? `Bonjour ${booking.userName},` : `Hello ${booking.userName},`,
    isFr
      ? `Votre consultation avec ${mentor.fullName} a été annulée par le consultant.`
      : `Your consultation with ${mentor.fullName} was cancelled by the consultant.`,
    refundLine,
  ]);

  sendResendEmail({ to: booking.userEmail, subject, html })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT CANCELLED (no Resend) → ${booking.userEmail} :: refund=${refundedAmount}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation cancelled email failed →`, err.message),
    );

  if (booking.userPhone) {
    const waText =
      (isFr ? '❌ Metwork — Consultation annulée\n' : '❌ Metwork — Consultation cancelled\n') +
      `${mentor.fullName}` +
      (refundedAmount > 0
        ? `\n${isFr ? 'Remboursé' : 'Refunded'}: ${refundedAmount.toLocaleString()} DZD`
        : '');
    if (process.env.SMS_PROVIDER === 'infobip') {
      sendWhatsAppMessage(booking.userPhone, waText).catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} WhatsApp cancel failed →`, err.message),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} WHATSAPP (cancel) → ${booking.userPhone} :: ${waText.slice(0, 80)}…`);
    }
  }
}

/* ─────────────────────────── Booking lifecycle emails ─────────────────────── */

export function sendBookingConfirmedWithQrEmail(
  email: string,
  opts: {
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
  },
): void {
  sendResendEmail({
    to: email,
    subject: `Booking confirmed — ${opts.itemName}`,
    html: bookingConfirmedWithQrEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (booking-confirmed+qr) → ${email} :: Booking ${opts.bookingId.slice(0, 8).toUpperCase()} confirmed for "${opts.itemName}"`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend booking-confirmed email failed →`, err.message),
    );
}

export function sendBookingDeclinedEmail(
  email: string,
  opts: {
    customerName: string;
    bookingId: string;
    itemName: string;
    itemKind: string;
    vendorName: string;
    totalAmount: number;
    declineReason?: string;
  },
): void {
  sendResendEmail({
    to: email,
    subject: `Booking update — ${opts.itemName}`,
    html: bookingDeclinedEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (booking-declined) → ${email} :: Booking ${opts.bookingId.slice(0, 8).toUpperCase()} declined, refund: ${opts.totalAmount} DZD`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend booking-declined email failed →`, err.message),
    );
}

/**
 * Sent when a provider cancels a client's UNPAID booking. States explicitly
 * that no payment was taken (no refund — nothing was charged). Fire-and-forget.
 */
export function sendBookingCancelledUnpaidEmail(
  email: string,
  opts: { customerName: string; bookingId: string; itemName: string; vendorName: string },
  lang: 'en' | 'fr' | 'ar' = 'en',
): void {
  const subject =
    lang === 'fr' ? `Réservation annulée — ${opts.itemName}`
    : lang === 'ar' ? `تم إلغاء الحجز — ${opts.itemName}`
    : `Booking cancelled — ${opts.itemName}`;
  sendResendEmail({
    to: email,
    subject,
    html: bookingCancelledUnpaidEmailHtml(opts, lang),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (booking-cancelled-unpaid) → ${email} :: Booking ${opts.bookingId.slice(0, 8).toUpperCase()} cancelled, no payment taken`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend booking-cancelled-unpaid email failed →`, err.message),
    );
}

export function sendWithdrawalRequestedEmail(
  email: string,
  opts: { userName: string; amount: number; accountDetails: string },
): void {
  sendResendEmail({
    to: email,
    subject: `Withdrawal request received — ${opts.amount.toLocaleString()} DZD`,
    html: withdrawalRequestedEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (withdrawal-requested) → ${email} :: ${opts.amount} DZD`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend withdrawal-requested email failed →`, err.message),
    );
}

export function sendWithdrawalProcessedEmail(
  email: string,
  opts: { userName: string; amount: number; status: 'APPROVED' | 'REJECTED'; adminNote?: string },
): void {
  recordE2eEmail(`withdrawal-${opts.status.toLowerCase()}`, { to: email, amount: opts.amount });
  sendResendEmail({
    to: email,
    subject: opts.status === 'APPROVED'
      ? `Withdrawal approved — ${opts.amount.toLocaleString()} DZD`
      : `Withdrawal update — ${opts.amount.toLocaleString()} DZD`,
    html: withdrawalProcessedEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (withdrawal-${opts.status.toLowerCase()}) → ${email} :: ${opts.amount} DZD`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend withdrawal-processed email failed →`, err.message),
    );
}

/**
 * Approval notice for a MANUAL withdrawal (bank transfer / CCP / cheque),
 * localised en/fr/ar. Fire-and-forget like every sender here — an email
 * failure never propagates into the approval money path.
 */
export function sendWithdrawalApprovedEmail(
  email: string,
  opts: {
    name: string;
    amount: number;
    method: 'bank_transfer' | 'ccp' | 'cheque' | null;
    adminNote?: string | null;
  },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): void {
  const fmtAmt = `${opts.amount.toLocaleString('fr-DZ')} DZD`;
  const subject =
    lang === 'fr' ? `Retrait traité — ${fmtAmt}`
    : lang === 'ar' ? `تمت معالجة السحب — ${fmtAmt}`
    : `Withdrawal processed — ${fmtAmt}`;

  recordE2eEmail('withdrawal-approved', { to: email, amount: opts.amount, method: opts.method });
  sendResendEmail({
    to: email,
    subject,
    html: withdrawalApprovedEmailHtml(opts, lang),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (withdrawal-approved/${opts.method ?? 'legacy'}) → ${email} :: ${opts.amount} DZD`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend withdrawal-approved email failed →`, err.message),
    );
}

export function sendContactNotification(submission: {
  name: string;
  email: string;
  message: string;
}): void {
  const adminEmail =
    process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';

  sendResendEmail({
    to: adminEmail,
    subject: `New contact form submission from ${submission.name}`,
    html: contactNotificationHtml(submission.name, submission.email, submission.message),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(
          `${banner} EMAIL → admin :: New contact from ${submission.name} <${submission.email}>\n${submission.message}`,
        );
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend email failed →`, err.message),
    );
}

/* ─────────────────────────── Booking receipts ─────────────────────────── */

/**
 * Generate a PDF receipt and email it to the client. Awaitable: the caller
 * SHOULD `await` this before returning so a serverless function doesn't suspend
 * mid-flight and drop the PDF + email. Never throws — errors are caught and
 * logged so the (already-committed) booking is never affected.
 */
export async function sendBookingReceiptEmailAsync(input: BookingReceiptInput): Promise<void> {
  const { booking, clientName, clientEmail, incubator, lang } = input;
  const isFr = lang === 'fr';

  // Resolve the receipt variant (deposit vs final vs standard). Card
  // CASH_DEPOSIT bookings get an interim 'deposit' receipt at settlement and a
  // 'final' one once the cash balance is collected.
  const isCashDeposit = booking.paymentMode === 'CASH_DEPOSIT';
  const variant = input.variant ?? (isCashDeposit
    ? (booking.paymentStatus === 'PAID' ? 'final' : 'deposit')
    : 'standard');

  const paymentLabel =
    booking.paymentMethod === 'wallet'
      ? isFr ? 'En ligne (portefeuille)' : 'Online (wallet)'
      : booking.paymentMethod === 'manual'
      ? isFr ? 'Espèces sur place' : 'Cash on-site'
      : booking.paymentMethod === 'card'
      ? isFr ? 'Carte (CIB / Edahabia)' : 'Card (CIB / Edahabia)'
      : '—';

  const subject = variant === 'deposit'
    ? (isFr
        ? `Votre reçu d’acompte – ${booking.itemName} – ${incubator.name}`
        : `Your deposit receipt – ${booking.itemName} – ${incubator.name}`)
    : variant === 'final'
    ? (isFr
        ? `Votre reçu (payé) – ${booking.itemName} – ${incubator.name}`
        : `Your receipt (paid in full) – ${booking.itemName} – ${incubator.name}`)
    : (isFr
        ? `Votre reçu – ${booking.itemName} – ${incubator.name}`
        : `Your receipt – ${booking.itemName} – ${incubator.name}`);

  const filename = `${variant === 'deposit' ? 'deposit-receipt' : 'receipt'}-${booking.clientReference.slice(0, 8)}.pdf`;

  try {
    const pdfBuffer = await generateBookingReceiptPdf(input);
    const sent = await sendResendEmail({
      to:      clientEmail,
      subject,
      html:    bookingReceiptEmailHtml({
        clientName,
        incubatorName:  incubator.name,
        itemName:       booking.itemName,
        reference:      booking.clientReference,
        startsAt:       booking.startsAt,
        endsAt:         booking.endsAt,
        totalAmount:    booking.totalAmount,
        paymentMethod:  paymentLabel,
        lang,
      }),
      attachments: [{ filename, content: pdfBuffer }],
    });
    if (!sent) {
      // eslint-disable-next-line no-console
      console.log(
        `${banner} RECEIPT (no Resend) → ${clientEmail} :: ${booking.itemName} ref=${booking.clientReference}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} RECEIPT sent → ${clientEmail} :: ref=${booking.clientReference}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${banner} Receipt email failed →`, (err as Error).message);
  }
}

/**
 * Fire-and-forget wrapper for callers that don't need to await delivery.
 * Prefer `sendBookingReceiptEmailAsync` inside serverless request handlers.
 */
export function sendBookingReceiptEmail(input: BookingReceiptInput): void {
  void sendBookingReceiptEmailAsync(input);
}

/**
 * Sent to the client when the incubator EDITS their (manual/offline) booking.
 * Awaitable + never throws. No payment language — manual bookings settle offline.
 */
export async function sendBookingUpdatedEmail(
  email: string,
  opts: {
    customerName: string;
    bookingId: string;
    itemName: string;
    vendorName: string;
    startsAt: string;
    endsAt: string;
    totalAmount: number;
  },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): Promise<void> {
  const subject =
    lang === 'fr' ? `Réservation modifiée — ${opts.itemName}`
    : lang === 'ar' ? `تم تعديل الحجز — ${opts.itemName}`
    : `Booking updated — ${opts.itemName}`;
  try {
    const sent = await sendResendEmail({ to: email, subject, html: bookingUpdatedEmailHtml(opts, lang) });
    if (!sent) {
      // eslint-disable-next-line no-console
      console.log(`${banner} EMAIL (booking-updated) → ${email} :: ${opts.bookingId.slice(0, 8).toUpperCase()}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${banner} Resend booking-updated email failed →`, (err as Error).message);
  }
}

/**
 * Sent to the client when the incubator DELETES their (manual/offline) booking.
 * Awaitable + never throws. No refund language — manual bookings settle offline.
 */
export async function sendBookingProviderCancelledEmail(
  email: string,
  opts: { customerName: string; bookingId: string; itemName: string; vendorName: string },
  lang: 'en' | 'fr' | 'ar' = 'fr',
): Promise<void> {
  const subject =
    lang === 'fr' ? `Réservation annulée — ${opts.itemName}`
    : lang === 'ar' ? `تم إلغاء الحجز — ${opts.itemName}`
    : `Booking cancelled — ${opts.itemName}`;
  try {
    const sent = await sendResendEmail({ to: email, subject, html: bookingProviderCancelledEmailHtml(opts, lang) });
    if (!sent) {
      // eslint-disable-next-line no-console
      console.log(`${banner} EMAIL (booking-provider-cancelled) → ${email} :: ${opts.bookingId.slice(0, 8).toUpperCase()}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${banner} Resend booking-provider-cancelled email failed →`, (err as Error).message);
  }
}

/* ─────────────────────────── Payment-link receipts ─────────────────────────── */

/**
 * Email the (account-less) payer their PDF receipt after a successful payment
 * link settlement. Fire-and-forget — errors are logged, never surfaced to the
 * settlement flow.
 */
export function sendPaymentLinkReceiptEmail(input: {
  link: PaymentLinkRecord;
  incubator: IncubatorRecord;
  lang: 'en' | 'fr';
}): void {
  const { link, incubator, lang } = input;
  const isFr = lang === 'fr';
  if (!link.payerEmail) return;

  const amount = link.amount;
  const payerFee = link.payerFeeAmount ?? 0;
  const grossCharge = link.grossChargedToPayer ?? amount + payerFee;
  const reference = link.id.slice(0, 8).toUpperCase();
  const filename = `receipt-${reference}.pdf`;

  generatePaymentLinkReceiptPdf({ link, incubator, lang })
    .then((pdfBuffer) =>
      sendResendEmail({
        to: link.payerEmail!,
        subject: isFr
          ? `Votre reçu – ${link.serviceName} – ${incubator.name}`
          : `Your receipt – ${link.serviceName} – ${incubator.name}`,
        html: paymentLinkReceiptEmailHtml({
          payerName: link.payerName ?? '',
          incubatorName: incubator.name,
          serviceName: link.serviceName,
          reference,
          amount,
          payerFee,
          grossCharge,
          lang,
        }),
        attachments: [{ filename, content: pdfBuffer }],
      }),
    )
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} PAY-LINK RECEIPT (no Resend) → ${link.payerEmail} :: ${link.serviceName} ref=${reference}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} PAY-LINK RECEIPT sent → ${link.payerEmail} :: ref=${reference}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Payment-link receipt email failed →`, err.message),
    );
}

/**
 * Notify the incubator owner of a new payment received via a payment link.
 * Skipped silently when the incubator record has no email. Fire-and-forget.
 */
export function sendPaymentLinkPaidIncubatorEmail(input: {
  link: PaymentLinkRecord;
  incubator: IncubatorRecord;
  lang: 'en' | 'fr';
}): void {
  const { link, incubator, lang } = input;
  const isFr = lang === 'fr';
  const to = incubator.email;
  if (!to) {
    // eslint-disable-next-line no-console
    console.log(`${banner} PAY-LINK INCUBATOR NOTIF skipped — no email on incubator record (id=${incubator.id})`);
    return;
  }

  const amount = link.amount;
  const commission = link.commissionAmount ?? 0;
  const netAmount = amount - commission;
  const reference = link.id.slice(0, 8).toUpperCase();
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/incubator/wallet`;

  sendResendEmail({
    to,
    subject: isFr
      ? `Nouveau paiement reçu — ${link.serviceName}`
      : `New payment received — ${link.serviceName}`,
    html: paymentLinkPaidEmailHtml({
      incubatorName: incubator.name,
      serviceName: link.serviceName,
      payerName: link.payerName ?? '—',
      payerEmail: link.payerEmail ?? '—',
      reference,
      netAmount,
      amount,
      commission,
      dashboardUrl,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} PAY-LINK INCUBATOR NOTIF (no Resend) → ${to} :: net=${netAmount} ref=${reference}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} PAY-LINK INCUBATOR NOTIF sent → ${to} :: ref=${reference}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Payment-link incubator notification failed →`, err.message),
    );
}

/**
 * Generate a consultation confirmation PDF and email it to the requester.
 * Fire-and-forget — never blocks the booking route.
 */
export async function sendConsultationConfirmationEmail(input: MentorConfirmationInput): Promise<void> {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';

  const subject = isFr
    ? `Demande de consultation confirmée – ${mentor.fullName}`
    : `Consultation request confirmed – ${mentor.fullName}`;

  const filename = `consultation-${booking.id.slice(0, 8)}.pdf`;

  // Compute estimated fee from mentor rate + duration (same formula as BookConsultationDialog)
  const feePerHour = mentor.consultationFee ?? 0;
  const dur        = booking.durationMinutes ?? null;
  const estimatedFee = (feePerHour > 0 && dur)
    ? Math.round((dur / 60) * feePerHour)
    : (feePerHour > 0 ? feePerHour : 0);

  // FIX: BUG-1 — decouple email from PDF: send email even if PDF generation fails
  const emailSend = generateMentorConfirmationPdf(input)
    .then(
      (pdfBuffer) =>
        // PDF succeeded — send with attachment
        sendResendEmail({
          to:      booking.userEmail,
          subject,
          html:    consultationConfirmationEmailHtml({
            clientName:      booking.userName,
            mentorName:      mentor.fullName,
            reference:       booking.id,
            lang,
            scheduledAt:     booking.scheduledAt ?? null,
            durationMinutes: booking.durationMinutes ?? null,
            estimatedFee:    feePerHour > 0 ? estimatedFee : null,
            meetLink:        booking.meetLink ?? null,
            isOffline:       booking.isOffline ?? false,
          }),
          attachments: [{ filename, content: pdfBuffer }],
        }),
      (pdfErr: Error) => {
        // FIX: BUG-1 — PDF failed: log separately, then send email WITHOUT attachment
        // eslint-disable-next-line no-console
        console.error(`${banner} PDF generation failed (sending email without attachment) →`, pdfErr.message);
        return sendResendEmail({
          to:      booking.userEmail,
          subject,
          html:    consultationConfirmationEmailHtml({
            clientName:      booking.userName,
            mentorName:      mentor.fullName,
            reference:       booking.id,
            lang,
            scheduledAt:     booking.scheduledAt ?? null,
            durationMinutes: booking.durationMinutes ?? null,
            estimatedFee:    feePerHour > 0 ? estimatedFee : null,
            meetLink:        booking.meetLink ?? null,
            isOffline:       booking.isOffline ?? false,
          }),
        });
      },
    )
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(
          `${banner} CONSULT CONFIRM (no Resend) → ${booking.userEmail} :: mentor=${mentor.fullName}`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT CONFIRM sent → ${booking.userEmail}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation confirmation email failed →`, err.message),
    );

  // WhatsApp notification (SMS cascade) — self-catching, awaited below.
  let phoneSend: Promise<void> = Promise.resolve();
  if (booking.userPhone) {
    const dur = booking.durationMinutes ? `${booking.durationMinutes} min` : '';
    const slot = booking.scheduledAt
      ? new Date(booking.scheduledAt).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' })
      : '';
    const linkPart = booking.meetLink
      ? `\nLien de réunion : ${booking.meetLink}`
      : booking.isOffline
      ? '\nFormat : En présentiel'
      : '';

    const waText =
      `✅ Metwork — Consultation confirmée\n` +
      `Consultant : ${mentor.fullName}` +
      (slot ? `\nDate : ${slot}` : '') +
      (dur  ? `\nDurée : ${dur}` : '') +
      linkPart +
      `\n\nVotre PDF de confirmation vous a été envoyé par email.`;

    phoneSend = deliverClientText(booking.userPhone, waText, 'consult-confirm');
  }

  await Promise.allSettled([emailSend, phoneSend]);
}

/**
 * Send a GUEST their secure pay link after admin approval.
 * Contains the confirmed schedule + amount + single-use pay button.
 * Fire-and-forget — never blocks the admin approval response.
 */
export function sendConsultationPayLinkEmail(input: {
  booking:    MentorConfirmationInput['booking'];
  mentor:     MentorConfirmationInput['mentor'];
  lang:       'en' | 'fr';
  payUrl:     string;
  amount:     number;
  expiresAt:  string;
}): void {
  const { booking, mentor, lang, payUrl, amount, expiresAt } = input;
  const isFr = lang === 'fr';
  const subject = isFr
    ? `Paiement requis — consultation avec ${mentor.fullName}`
    : `Payment required — consultation with ${mentor.fullName}`;

  sendResendEmail({
    to:      booking.userEmail,
    subject,
    html:    consultationPayLinkEmailHtml({
      clientName:      booking.userName,
      mentorName:      mentor.fullName,
      reference:       booking.id,
      payUrl,
      amount,
      expiresAt,
      lang,
      scheduledAt:     booking.scheduledAt ?? null,
      durationMinutes: booking.durationMinutes ?? null,
      meetLink:        booking.meetLink ?? null,
      isOffline:       booking.isOffline ?? false,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT PAY LINK (no Resend) → ${booking.userEmail} :: ${payUrl}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT PAY LINK sent → ${booking.userEmail}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation pay-link email failed →`, err.message),
    );

  // WhatsApp nudge — fire-and-forget.
  if (booking.userPhone) {
    const waText =
      (isFr ? '💳 Metwork — Paiement requis\n' : '💳 Metwork — Payment required\n') +
      (isFr ? `Consultant : ${mentor.fullName}` : `Consultant: ${mentor.fullName}`) +
      `\n${isFr ? 'Montant' : 'Amount'}: ${amount.toLocaleString('fr-DZ')} DZD` +
      `\n${isFr ? 'Payer ici' : 'Pay here'}: ${payUrl}`;
    if (process.env.SMS_PROVIDER === 'infobip') {
      sendWhatsAppMessage(booking.userPhone, waText).catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} WhatsApp pay-link failed →`, err.message),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} WHATSAPP (pay-link) → ${booking.userPhone} :: ${waText.slice(0, 80)}…`);
    }
  }
}

/**
 * Notify the client that their consultation request was received (PENDING — not yet confirmed).
 * Replaces the previous "confirmation" email that was wrongly sent at booking time.
 */
export async function sendConsultationRequestReceivedEmail(input: MentorConfirmationInput): Promise<void> {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';
  const subject = isFr
    ? `Demande reçue – consultation avec ${mentor.fullName}`
    : `Request received – consultation with ${mentor.fullName}`;

  await sendResendEmail({
    to:      booking.userEmail,
    subject,
    html:    consultationRequestReceivedEmailHtml({
      clientName:       booking.userName,
      mentorName:       mentor.fullName,
      reference:        booking.id,
      consultationDate: booking.consultationDate,
      consultationTime: booking.consultationTime,
      durationMinutes:  booking.durationMinutes,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REQUEST RECEIVED (no Resend) → ${booking.userEmail}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REQUEST RECEIVED sent → ${booking.userEmail}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation request-received email failed →`, err.message),
    );
}

/**
 * Notify the client that their consultation request was rejected.
 */
export function sendConsultationRejectedEmail(input: {
  booking:   MentorConfirmationInput['booking'];
  mentor:    MentorConfirmationInput['mentor'];
  adminNote: string | null;
  lang:      'en' | 'fr';
}): void {
  const { booking, mentor, adminNote, lang } = input;
  const isFr = lang === 'fr';
  const subject = isFr
    ? `Demande de consultation refusée – ${mentor.fullName}`
    : `Consultation request declined – ${mentor.fullName}`;

  sendResendEmail({
    to:   booking.userEmail,
    subject,
    html: consultationRejectedEmailHtml({
      clientName: booking.userName,
      mentorName: mentor.fullName,
      adminNote,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REJECTED (no Resend) → ${booking.userEmail}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} CONSULT REJECTED sent → ${booking.userEmail}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Consultation rejected email failed →`, err.message),
    );
}

/**
 * Notify the admin of a new paid order (space booking, program application, event registration).
 * Fire-and-forget — errors are logged, never surfaced.
 */
export function sendAdminOrderNotification(params: AdminOrderNotifParams): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';
  const kindLabel  =
    params.orderKind === 'SPACE'   ? 'Espace'
    : params.orderKind === 'PROGRAM' ? 'Programme'
    : 'Événement';

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouvelle commande ${kindLabel} — ${params.customerName} (${params.amount > 0 ? `${params.amount.toLocaleString()} DZD` : 'Gratuit'})`,
    html:    adminOrderNotificationHtml(params),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN ORDER NOTIF (no Resend) → ${adminEmail} :: ${params.orderKind} ${params.reference.slice(0, 8).toUpperCase()}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN ORDER NOTIF sent → ${adminEmail} :: ${params.orderKind}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Admin order notification failed →`, err.message),
    );
}

/**
 * Notify the admin when a new INCUBATOR account is verified.
 * Fire-and-forget — errors are logged, never surfaced.
 */
export function sendAdminNewIncubatorNotification(params: {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
  incubatorName?: string;
  website?:  string | null;
  instagram?: string | null;
}): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';
  const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/admin/incubators`;

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouvel incubateur inscrit — ${params.incubatorName ?? params.fullName}`,
    html:    adminIncubatorNotificationHtml({ ...params, reviewUrl }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN INCUBATOR NOTIF (no Resend) → ${adminEmail} :: ${params.email}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN INCUBATOR NOTIF sent → ${adminEmail} :: ${params.email}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Admin incubator notification failed →`, err.message),
    );
}

/**
 * Notify the admin when a new INVESTOR account is verified (review required).
 * Fire-and-forget — errors are logged, never surfaced.
 */
export function sendAdminNewInvestorNotification(params: {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
  linkedin?: string | null;
}): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';
  const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/admin/investors`;

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouvel investisseur inscrit — ${params.fullName}`,
    html:    adminInvestorNotificationHtml({ ...params, reviewUrl }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN INVESTOR NOTIF (no Resend) → ${adminEmail} :: ${params.email}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN INVESTOR NOTIF sent → ${adminEmail} :: ${params.email}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Admin investor notification failed →`, err.message),
    );
}

/**
 * Notify the admin when a new BUSINESS account is verified (review required).
 * Reuses the provider-notification template (business behaves like a provider).
 * Fire-and-forget — errors are logged, never surfaced.
 */
export function sendAdminNewBusinessNotification(params: {
  fullName:  string;
  email:     string;
  phone?:    string;
  userId:    string;
  createdAt: string;
  businessName?: string;
  subTypeLabel?: string;
  website?:  string | null;
  instagram?: string | null;
}): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';
  const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/admin/approvals`;
  const label = params.subTypeLabel ?? 'Business';

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouveau compte ${label} inscrit — ${params.businessName ?? params.fullName}`,
    html:    adminIncubatorNotificationHtml({
      fullName:      params.fullName,
      email:         params.email,
      phone:         params.phone,
      userId:        params.userId,
      createdAt:     params.createdAt,
      incubatorName: params.businessName,
      website:       params.website,
      instagram:     params.instagram,
      reviewUrl,
    }),
  })
    .then((sent) => {
      // eslint-disable-next-line no-console
      console.log(`${banner} ADMIN BUSINESS NOTIF ${sent ? 'sent' : '(no Resend)'} → ${adminEmail} :: ${params.email}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Admin business notification failed →`, err.message),
    );
}

/**
 * Notify the mentor (consultant) that their session has been confirmed by admin.
 * Sent alongside the client's confirmation email.
 * Skipped silently when the MentorRecord has no email address.
 */
export async function sendMentorSessionConfirmedEmail(input: MentorConfirmationInput): Promise<void> {
  const { booking, mentor } = input;

  if (!mentor.email) {
    // eslint-disable-next-line no-console
    console.log(`${banner} MENTOR CONFIRM skipped — no email on mentor record (id=${mentor.id})`);
    return;
  }

  await sendResendEmail({
    to:      mentor.email,
    subject: `Session confirmed — ${booking.userName} (${booking.id.slice(0, 8).toUpperCase()})`,
    html:    mentorSessionConfirmedEmailHtml({
      mentorName:      mentor.fullName,
      clientName:      booking.userName,
      clientEmail:     booking.userEmail,
      clientPhone:     booking.userPhone,
      scheduledAt:     booking.scheduledAt ?? null,
      durationMinutes: booking.durationMinutes ?? null,
      meetLink:        booking.meetLink ?? null,
      isOffline:       booking.isOffline ?? false,
      adminNote:       booking.adminNote ?? null,
      reference:       booking.id,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} MENTOR CONFIRM (no Resend) → ${mentor.email} :: client=${booking.userName}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} MENTOR CONFIRM sent → ${mentor.email} :: client=${booking.userName}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Mentor session-confirmed email failed →`, err.message),
    );
}

/**
 * Notify the admin that a new consultation request has been submitted.
 */
export function sendAdminConsultationNotification(input: MentorConfirmationInput): void {
  const { booking, mentor } = input;
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouvelle demande de consultation — ${booking.userName} → ${mentor.fullName}`,
    html:    adminConsultationNotificationHtml({
      userName:         booking.userName,
      userEmail:        booking.userEmail,
      userPhone:        booking.userPhone,
      mentorName:       mentor.fullName,
      message:          booking.message,
      bookingId:        booking.id,
      consultationDate: booking.consultationDate,
      consultationTime: booking.consultationTime,
      durationMinutes:  booking.durationMinutes,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN CONSULT NOTIF (no Resend) → ${adminEmail}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} ADMIN CONSULT NOTIF sent → ${adminEmail}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Admin consultation notification failed →`, err.message),
    );
}

/* ─────────── REQUEST-mode space reservations (approve-then-pay) ─────────── */

/** Shared booking details every REQUEST-mode reservation email needs. */
export interface ReservationEmailDetails {
  bookingId: string;
  itemName: string;
  vendorName: string;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
}

/**
 * Client email — "Request sent, awaiting host approval". Fire-and-forget.
 */
export function sendBookingRequestReceivedEmail(
  to: string,
  opts: { customerName: string; details: ReservationEmailDetails; lang?: EmailLang },
): void {
  const { customerName, details, lang } = opts;
  const subject =
    lang === 'en' ? `Request sent — ${details.itemName}`
    : lang === 'ar' ? `تم إرسال الطلب — ${details.itemName}`
    : `Demande envoyée — ${details.itemName}`;

  recordE2eEmail('booking-request-received', { to, bookingId: details.bookingId });
  sendResendEmail({
    to,
    subject,
    html: bookingRequestReceivedEmailHtml({
      customerName,
      itemName: details.itemName,
      vendorName: details.vendorName,
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      totalAmount: details.totalAmount,
      lang,
    }),
  })
    .then((sent) => {
      // eslint-disable-next-line no-console
      console.log(`${banner} BOOKING REQUEST RECEIVED ${sent ? 'sent' : '(no Resend)'} → ${to} :: ${details.bookingId}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Booking request-received email failed →`, err.message),
    );
}

/**
 * Incubator email — "New booking request awaiting approval" + dashboard link.
 * Skipped silently when the incubator record has no email. Fire-and-forget.
 */
export function sendIncubatorBookingRequestEmail(
  incubator: IncubatorRecord,
  opts: { customerName: string; details: ReservationEmailDetails; lang?: EmailLang },
): void {
  const { customerName, details, lang } = opts;
  const to = incubator.email;
  if (!to) {
    // eslint-disable-next-line no-console
    console.log(`${banner} BOOKING REQUEST INCUBATOR NOTIF skipped — no email on incubator record (id=${incubator.id})`);
    return;
  }
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/incubator/bookings`;
  const subject =
    lang === 'en' ? `New booking request — ${details.itemName}`
    : lang === 'ar' ? `طلب حجز جديد — ${details.itemName}`
    : `Nouvelle demande de réservation — ${details.itemName}`;

  recordE2eEmail('booking-request-incubator', { to, bookingId: details.bookingId });
  sendResendEmail({
    to,
    subject,
    html: incubatorBookingRequestEmailHtml({
      incubatorName: incubator.name,
      customerName,
      itemName: details.itemName,
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      totalAmount: details.totalAmount,
      dashboardUrl,
      lang,
    }),
  })
    .then((sent) => {
      // eslint-disable-next-line no-console
      console.log(`${banner} BOOKING REQUEST INCUBATOR NOTIF ${sent ? 'sent' : '(no Resend)'} → ${to} :: ${details.bookingId}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Booking request incubator email failed →`, err.message),
    );
}

/**
 * Client email — "Your booking is approved, complete payment" with the
 * tokenized pay link. Fire-and-forget. The raw pay URL is recorded in the
 * e2e sink (USE_LOCAL_DB only) so tests can retrieve it — the DB stores only
 * the token's SHA-256 hash.
 */
export function sendBookingApprovedPayEmail(
  to: string,
  opts: {
    customerName: string;
    details: ReservationEmailDetails;
    payUrl: string;
    expiresAt: string;
    lang?: EmailLang;
  },
): void {
  const { customerName, details, payUrl, expiresAt, lang } = opts;
  const subject =
    lang === 'en' ? `Booking approved — complete payment — ${details.itemName}`
    : lang === 'ar' ? `تمت الموافقة على الحجز — أكمل الدفع — ${details.itemName}`
    : `Réservation approuvée — finalisez le paiement — ${details.itemName}`;

  recordE2eEmail('booking-approved-pay-link', { to, bookingId: details.bookingId, payUrl });
  sendResendEmail({
    to,
    subject,
    html: bookingApprovedPayEmailHtml({
      customerName,
      itemName: details.itemName,
      vendorName: details.vendorName,
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      totalAmount: details.totalAmount,
      payUrl,
      expiresAt,
      lang,
    }),
  })
    .then((sent) => {
      if (!sent)
        // eslint-disable-next-line no-console
        console.log(`${banner} BOOKING PAY LINK (no Resend) → ${to} :: ${payUrl}`);
      else
        // eslint-disable-next-line no-console
        console.log(`${banner} BOOKING PAY LINK sent → ${to} :: ${details.bookingId}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Booking approved pay-link email failed →`, err.message),
    );
}

/**
 * Incubator email — "Booking paid & confirmed" once the client settles a
 * REQUEST-mode reservation. Skipped when the record has no email.
 */
export function sendBookingPaidIncubatorEmail(
  incubator: IncubatorRecord,
  opts: { customerName: string; details: ReservationEmailDetails; lang?: EmailLang },
): void {
  const { customerName, details, lang } = opts;
  const to = incubator.email;
  if (!to) {
    // eslint-disable-next-line no-console
    console.log(`${banner} BOOKING PAID INCUBATOR NOTIF skipped — no email on incubator record (id=${incubator.id})`);
    return;
  }
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/incubator/bookings`;
  const subject =
    lang === 'en' ? `Booking paid & confirmed — ${details.itemName}`
    : lang === 'ar' ? `تم دفع الحجز وتأكيده — ${details.itemName}`
    : `Réservation payée et confirmée — ${details.itemName}`;

  recordE2eEmail('booking-paid-incubator', { to, bookingId: details.bookingId });
  sendResendEmail({
    to,
    subject,
    html: bookingPaidIncubatorEmailHtml({
      incubatorName: incubator.name,
      customerName,
      itemName: details.itemName,
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      totalAmount: details.totalAmount,
      dashboardUrl,
      lang,
    }),
  })
    .then((sent) => {
      // eslint-disable-next-line no-console
      console.log(`${banner} BOOKING PAID INCUBATOR NOTIF ${sent ? 'sent' : '(no Resend)'} → ${to} :: ${details.bookingId}`);
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Booking paid incubator email failed →`, err.message),
    );
}
