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

import { sendWhatsAppOTP, sendSMSOTP } from './sms';
import {
  sendResendEmail,
  otpEmailHtml,
  welcomeEmailHtml,
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

/* ─────────────────────────── WhatsApp / SMS ─────────────────────────── */

/**
 * Send OTP via WhatsApp (Infobip primary channel).
 * Falls back to console.log when INFOBIP_* vars are not set.
 */
export function sendOtpWhatsApp(phone: string, code: string): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP → ${phone} :: code = ${code}`);
  }

  if (process.env.SMS_PROVIDER === 'infobip') {
    sendWhatsAppOTP(phone, code).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Infobip WhatsApp failed →`, err.message),
    );
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP (mock) → ${phone} :: code = ${code}`);
  }
}

/**
 * Send OTP via SMS (Infobip fallback channel).
 */
export function sendOtpSms(phone: string, code: string): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} SMS → ${phone} :: code = ${code}`);
  }

  if (process.env.SMS_PROVIDER === 'infobip') {
    sendSMSOTP(phone, code).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Infobip SMS failed →`, err.message),
    );
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.log(`${banner} SMS (mock) → ${phone} :: code = ${code}`);
  }
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

export function sendBookingReceiptEmail(
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
    status: string;
    createdAt: string;
  },
): void {
  sendResendEmail({
    to: email,
    subject: `Booking confirmed — ${opts.itemName}`,
    html: bookingReceiptEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(
          `${banner} EMAIL (receipt) → ${email} :: Booking ${opts.bookingId.slice(0, 8).toUpperCase()} for "${opts.itemName}" confirmed, amount: ${opts.totalAmount} DZD`,
        );
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend receipt email failed →`, err.message),
    );
}

/* ─────────────────────────── Booking lifecycle emails ─────────────────────── */

export function sendBookingPendingEmail(
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
    subject: `Booking request received — ${opts.itemName}`,
    html: bookingPendingEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (booking-pending) → ${email} :: Booking ${opts.bookingId.slice(0, 8).toUpperCase()} pending for "${opts.itemName}"`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend booking-pending email failed →`, err.message),
    );
}

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

export function sendNewBookingAlert(
  incubatorEmail: string,
  incubatorPhone: string,
  opts: {
    incubatorName: string;
    customerName: string;
    bookingId: string;
    itemName: string;
    itemKind: string;
    startsAt: string;
    endsAt: string;
    totalAmount: number;
  },
): void {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
  const dashboardUrl = `${baseUrl}/en/dashboard/incubator/bookings`;

  // Email to incubator
  sendResendEmail({
    to: incubatorEmail,
    subject: `New booking — ${opts.itemName}`,
    html: newBookingAlertHtml({ ...opts, dashboardUrl }),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (new-booking-alert) → ${incubatorEmail} :: New booking from ${opts.customerName} for "${opts.itemName}"`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend new-booking-alert email failed →`, err.message),
    );

  // WhatsApp notification to incubator (best-effort)
  const waMessage = `New booking on Metwork!\nCustomer: ${opts.customerName}\nService: ${opts.itemName}\nReview at: ${dashboardUrl}`;
  if (process.env.SMS_PROVIDER === 'infobip') {
    sendWhatsAppOTP(incubatorPhone, waMessage).catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} WhatsApp new-booking-alert failed →`, err.message),
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(`${banner} WHATSAPP (new-booking-alert, mock) → ${incubatorPhone} :: ${waMessage}`);
  }
}

export function sendConsultationApprovedEmail(
  email: string,
  opts: {
    userName: string;
    mentorName: string;
    scheduledAt: string | null;
    meetLink: string | null;
    adminNote?: string;
  },
): void {
  sendResendEmail({
    to: email,
    subject: `Consultation confirmed — ${opts.mentorName}`,
    html: consultationApprovedEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (consultation-approved) → ${email} :: Session with ${opts.mentorName}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend consultation-approved email failed →`, err.message),
    );
}

export function sendConsultationApprovedMentorEmail(
  mentorEmail: string,
  opts: {
    mentorName: string;
    clientName: string;
    clientEmail: string;
    scheduledAt: string | null;
    meetLink: string | null;
    isOffline: boolean;
    adminNote?: string;
  },
): void {
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/en/dashboard/admin/mentor-bookings`;
  sendResendEmail({
    to: mentorEmail,
    subject: `New confirmed consultation — ${opts.clientName}`,
    html: consultationApprovedMentorEmailHtml({ ...opts, dashboardUrl }),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (consultation-approved-mentor) → ${mentorEmail} :: Session with ${opts.clientName}`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend consultation-approved-mentor email failed →`, err.message),
    );
}

export function sendConsultationRejectedEmail(
  email: string,
  opts: { userName: string; mentorName: string; adminNote?: string },
): void {
  sendResendEmail({
    to: email,
    subject: `Consultation update — ${opts.mentorName}`,
    html: consultationRejectedEmailHtml(opts),
  })
    .then((sent) => {
      if (!sent) {
        // eslint-disable-next-line no-console
        console.log(`${banner} EMAIL (consultation-rejected) → ${email} :: Session with ${opts.mentorName} declined`);
      }
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error(`${banner} Resend consultation-rejected email failed →`, err.message),
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
