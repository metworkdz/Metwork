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

import { sendWhatsAppOTP, sendSMSOTP, sendWhatsAppMessage } from './sms';
import {
  sendResendEmail,
  otpEmailHtml,
  welcomeEmailHtml,
  verificationEmailHtml,
  passwordResetEmailHtml,
  contactNotificationHtml,
  bookingReceiptEmailHtml,
  bookingConfirmedWithQrEmailHtml,
  bookingDeclinedEmailHtml,
  withdrawalRequestedEmailHtml,
  withdrawalProcessedEmailHtml,
  consultationConfirmationEmailHtml,
  consultationPayLinkEmailHtml,
  consultationRequestReceivedEmailHtml,
  consultationRejectedEmailHtml,
  adminConsultationNotificationHtml,
  adminOrderNotificationHtml,
  adminIncubatorNotificationHtml,
  mentorSessionConfirmedEmailHtml,
  type AdminOrderNotifParams,
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

  // Compute estimated fee from mentor rate + duration (same formula as BookConsultationDialog)
  const feePerHour = mentor.consultationFee ?? 0;
  const dur        = booking.durationMinutes ?? null;
  const estimatedFee = (feePerHour > 0 && dur)
    ? Math.round((dur / 60) * feePerHour)
    : (feePerHour > 0 ? feePerHour : 0);

  // FIX: BUG-1 — decouple email from PDF: send email even if PDF generation fails
  generateMentorConfirmationPdf(input)
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

  // WhatsApp notification — fire-and-forget, never blocks
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

    if (process.env.SMS_PROVIDER === 'infobip') {
      sendWhatsAppMessage(booking.userPhone, waText).catch((err: Error) =>
        // eslint-disable-next-line no-console
        console.error(`${banner} WhatsApp consult confirm failed →`, err.message),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`${banner} WHATSAPP (consult-confirm) → ${booking.userPhone} :: ${waText.slice(0, 80)}…`);
    }
  }
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
}): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';

  sendResendEmail({
    to:      adminEmail,
    subject: `[Metwork] Nouvel incubateur inscrit — ${params.fullName}`,
    html:    adminIncubatorNotificationHtml(params),
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
 * Notify the mentor (consultant) that their session has been confirmed by admin.
 * Sent alongside the client's confirmation email.
 * Skipped silently when the MentorRecord has no email address.
 */
export function sendMentorSessionConfirmedEmail(input: MentorConfirmationInput): void {
  const { booking, mentor } = input;

  if (!mentor.email) {
    // eslint-disable-next-line no-console
    console.log(`${banner} MENTOR CONFIRM skipped — no email on mentor record (id=${mentor.id})`);
    return;
  }

  sendResendEmail({
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
