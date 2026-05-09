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

import { sendTwilioSms } from './sms';
import {
  sendResendEmail,
  otpEmailHtml,
  verificationEmailHtml,
  passwordResetEmailHtml,
  contactNotificationHtml,
  bookingReceiptEmailHtml,
  consultationConfirmationEmailHtml,
  consultationRequestReceivedEmailHtml,
  consultationRejectedEmailHtml,
  adminConsultationNotificationHtml,
} from './email';
import {
  generateBookingReceiptPdf,
  generateMentorConfirmationPdf,
  type BookingReceiptInput,
  type MentorConfirmationInput,
} from './receipt';

const banner = '\x1b[36m[notify]\x1b[0m';

/* ─────────────────────────── SMS ─────────────────────────── */

export function sendOtpSms(phone: string, code: string): void {
  const body = `Your Metwork verification code is ${code}`;

  if (process.env.SMS_PROVIDER === 'twilio') {
    // Always surface the OTP in the server terminal during development so you
    // can verify the code without waiting for the real SMS to arrive.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`${banner} SMS (twilio) → ${phone} :: ${body}`);
    }
    sendTwilioSms(phone, body).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Twilio SMS failed →`, err.message),
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`${banner} SMS → ${phone} :: ${body}`);
}

/**
 * Send OTP via email (Resend).  Used as a reliable fallback when SMS
 * cannot be trusted (carrier geo-filtering, test environments, etc.).
 * Falls back to console.log when Resend is not configured.
 */
export function sendOtpEmail(email: string, code: string): void {
  sendResendEmail({
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

/* ─────────────────────────── Email ─────────────────────────── */

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
 * Generate a PDF receipt and email it to the client.
 * Fire-and-forget — errors are logged, never surfaced to the booking flow.
 *
 * @param input - Same shape as BookingReceiptInput used by the PDF generator.
 */
export function sendBookingReceiptEmail(input: BookingReceiptInput): void {
  const { booking, clientName, clientEmail, incubator, lang } = input;
  const isFr = lang === 'fr';

  const paymentLabel =
    booking.paymentMethod === 'ONLINE'
      ? isFr ? 'En ligne (portefeuille)' : 'Online (wallet)'
      : booking.paymentMethod === 'CASH'
      ? isFr ? 'Espèces sur place' : 'Cash on-site'
      : '—';

  const subject = isFr
    ? `Votre reçu – ${booking.itemName} – ${incubator.name}`
    : `Your receipt – ${booking.itemName} – ${incubator.name}`;

  const filename = `receipt-${booking.clientReference.slice(0, 8)}.pdf`;

  generateBookingReceiptPdf(input)
    .then((pdfBuffer) =>
      sendResendEmail({
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
      }),
    )
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(
          `${banner} RECEIPT (no Resend) → ${clientEmail} :: ${booking.itemName} ref=${booking.clientReference}`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(`${banner} RECEIPT sent → ${clientEmail} :: ref=${booking.clientReference}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Receipt email failed →`, err.message),
    );
}

/**
 * Generate a consultation confirmation PDF and email it to the requester.
 * Fire-and-forget — never blocks the booking route.
 */
export function sendConsultationConfirmationEmail(input: MentorConfirmationInput): void {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';

  const subject = isFr
    ? `Demande de consultation confirmée – ${mentor.fullName}`
    : `Consultation request confirmed – ${mentor.fullName}`;

  const filename = `consultation-${booking.id.slice(0, 8)}.pdf`;

  generateMentorConfirmationPdf(input)
    .then((pdfBuffer) =>
      sendResendEmail({
        to:      booking.userEmail,
        subject,
        html:    consultationConfirmationEmailHtml({
          clientName: booking.userName,
          mentorName: mentor.fullName,
          reference:  booking.id,
          lang,
        }),
        attachments: [{ filename, content: pdfBuffer }],
      }),
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
}

/**
 * Notify the client that their consultation request was received (PENDING — not yet confirmed).
 * Replaces the previous "confirmation" email that was wrongly sent at booking time.
 */
export function sendConsultationRequestReceivedEmail(input: MentorConfirmationInput): void {
  const { booking, mentor, lang } = input;
  const isFr = lang === 'fr';
  const subject = isFr
    ? `Demande reçue – consultation avec ${mentor.fullName}`
    : `Request received – consultation with ${mentor.fullName}`;

  sendResendEmail({
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
