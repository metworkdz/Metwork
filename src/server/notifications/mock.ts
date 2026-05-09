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
  bookingPendingEmailHtml,
  bookingConfirmedWithQrEmailHtml,
  bookingDeclinedEmailHtml,
  newBookingAlertHtml,
  consultationApprovedEmailHtml,
  consultationApprovedMentorEmailHtml,
  consultationRejectedEmailHtml,
  withdrawalRequestedEmailHtml,
  withdrawalProcessedEmailHtml,
} from './email';

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
