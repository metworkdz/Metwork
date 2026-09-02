/**
 * POST /api/auth/signup-pending
 *
 * "Book & create an account" — register a PENDING account that is tied to an
 * in-flight booking, then issue an EMAIL OTP. Reuses the exact same auth
 * helpers as the normal signup flow (`issuePendingUser` → `/api/auth/verify-otp`
 * → `promotePendingUser`); no new auth logic is introduced here.
 *
 * Two booking shapes are carried through OTP via a server-side pointer stamped
 * on the pending-user record (`pendingBooking`):
 *   - CARD  (SPACE / PROGRAM / EVENT): the server creates a GUEST card-booking
 *           intent here (userId = null) and stores its pay token. T/D/fee are
 *           recomputed server-side — the client never supplies a price.
 *   - CONSULTATION: links an existing guest consultation request (created by
 *           the client via /api/mentors/:id/guest-book moments earlier).
 *
 * On successful OTP verification the booking is re-assigned to the promoted
 * user and the OTP form is redirected to the pay page (CARD) or the dashboard
 * pending-approval view (CONSULTATION). See /api/auth/verify-otp.
 *
 * Security: conflicts against the REAL users table are checked FIRST, so no
 * booking/account is created when the email or phone already exists. Email and
 * phone are normalised; the role is fixed to ENTREPRENEUR; the OTP is hashed by
 * `issuePendingUser`. Rate-limited per IP.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { emailSchema, phoneSchema, passwordSchema } from '@/lib/validators';
import { hashPassword } from '@/server/auth/password';
import { issuePendingUser } from '@/server/auth/pending-users';
import { maskPhone, maskEmail, normalizePhone } from '@/server/auth/serialize';
import { createCardBookingIntent } from '@/server/bookings/card-payment';
import { sendOtpEmail } from '@/server/notifications/mock';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import type { Locale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cardTargetSchema = z.discriminatedUnion('itemKind', [
  z.object({
    itemKind: z.literal('SPACE'),
    spaceId: z.string().min(1),
    unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  z.object({ itemKind: z.literal('PROGRAM'), programId: z.string().min(1) }),
  z.object({ itemKind: z.literal('EVENT'), eventId: z.string().min(1) }),
]);

const signupPendingSchema = z
  .object({
    fullName: z.string().min(2).max(120),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    city: z.string().min(1).max(80),
    locale: z.enum(['en', 'fr', 'ar']).optional(),
    intent: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('CARD'),
        target: cardTargetSchema,
        paymentMode: z.enum(['ONLINE_FULL', 'CASH_DEPOSIT']),
        promoCode: z.string().min(1).max(50).optional(),
        clientReference: z.string().min(8).max(128),
      }),
      z.object({
        kind: z.literal('CONSULTATION'),
        mentorBookingId: z.string().min(1).max(80),
      }),
    ]),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  });

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function pickLocale(req: NextRequest): Locale {
  const header = req.headers.get('accept-language')?.toLowerCase() ?? '';
  if (header.startsWith('ar')) return 'ar';
  if (header.startsWith('fr')) return 'fr';
  return 'en';
}

/** Map a card-intent failure to the same HTTP shapes as /api/bookings/card. */
function cardIntentError(reason: string, detail?: Record<string, unknown>) {
  switch (reason) {
    case 'ITEM_NOT_FOUND':
      return jsonError(404, 'ITEM_NOT_FOUND', 'This listing is no longer available');
    case 'MODE_NOT_ACCEPTED':
      return jsonError(422, 'MODE_NOT_ACCEPTED', 'This payment option is not accepted for this listing');
    case 'DEPOSIT_NOT_CONFIGURED':
      return jsonError(422, 'DEPOSIT_NOT_CONFIGURED', 'A cash deposit is not configured for this listing');
    case 'INVALID_DEPOSIT_CONFIG':
      return jsonError(422, 'INVALID_DEPOSIT_CONFIG', 'The cash deposit configuration is invalid');
    case 'INVALID_TOTAL':
      return jsonError(422, 'INVALID_TOTAL', 'This listing has no payable amount');
    case 'UNIT_NOT_AVAILABLE':
      return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', detail);
    case 'OUTSIDE_WORKING_HOURS':
      return jsonError(422, 'OUTSIDE_WORKING_HOURS', 'Booking is outside working hours', detail);
    case 'NOT_A_WORKING_DAY':
      return jsonError(422, 'NOT_A_WORKING_DAY', 'Selected day is not a working day', detail);
    case 'DATE_UNAVAILABLE':
      return jsonError(422, 'DATE_UNAVAILABLE', 'The selected date(s) are not available for booking', detail);
    case 'OVERLAP_CONFLICT':
      return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked', detail);
    case 'CAPACITY_EXCEEDED':
      return jsonError(409, 'CAPACITY_EXCEEDED', 'No seats remaining', detail);
    case 'DEADLINE_PASSED':
      return jsonError(409, 'DEADLINE_PASSED', 'The application deadline has passed', detail);
    case 'EVENT_PASSED':
      return jsonError(409, 'EVENT_PASSED', 'This event has already taken place', detail);
    case 'ALREADY_BOOKED':
      return jsonError(409, 'ALREADY_BOOKED', 'You already have an active booking for this listing', detail);
    default:
      return jsonError(400, 'BOOKING_FAILED', 'Could not create the booking');
  }
}

export async function POST(req: NextRequest) {
  // 8 attempts / IP / hour. Idempotency on the booking clientReference covers
  // honest retries; this throttles abuse.
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`signup-pending:ip:${ip}`, 8, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = signupPendingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  const locale = input.locale ?? pickLocale(req);

  // Conflict check FIRST — never create a booking/account when the email or
  // phone already belongs to a real user (tell them to log in instead).
  const snapshot = await db.read();
  if (snapshot.users.some((u) => u.email === email)) {
    return jsonError(409, 'EMAIL_EXISTS', 'Email already in use');
  }
  if (snapshot.users.some((u) => normalizePhone(u.phone) === phone)) {
    return jsonError(409, 'PHONE_EXISTS', 'Phone already in use');
  }

  // ── Build the booking carry ────────────────────────────────────────────
  let carry: { kind: 'CARD' | 'CONSULTATION'; ref: string };
  if (input.intent.kind === 'CARD') {
    // Create the GUEST card intent server-side (no client-trusted token). The
    // server recomputes T / D / fee; a brand-new account has no membership tier,
    // so the discount is 0 — the account price equals the guest price.
    const result = await createCardBookingIntent({
      target: input.intent.target,
      paymentMode: input.intent.paymentMode,
      userId: null,
      customer: { fullName: input.fullName.trim(), email, phone },
      clientReference: input.intent.clientReference,
      promoCode: input.intent.promoCode ?? null,
      membershipDiscount: 0,
      locale,
    });
    if (!result.ok) return cardIntentError(result.reason, result.detail);
    carry = { kind: 'CARD', ref: result.token };
  } else {
    // CONSULTATION — link an existing guest request created moments earlier.
    // Only an unclaimed (userId === null) guest request may be attached.
    const intent = input.intent;
    const mb = (snapshot.mentorBookings ?? []).find((b) => b.id === intent.mentorBookingId);
    if (!mb || mb.source !== 'guest') {
      return jsonError(404, 'BOOKING_NOT_FOUND', 'Consultation request not found');
    }
    if (mb.userId) {
      return jsonError(409, 'BOOKING_CLAIMED', 'This request is already linked to an account');
    }
    carry = { kind: 'CONSULTATION', ref: mb.id };
  }

  // ── Create the pending account + issue the OTP (reuses signup helpers) ──
  const passwordHash = await hashPassword(input.password);
  const { id, otpCode } = await issuePendingUser({
    fullName: input.fullName.trim(),
    email,
    phone,
    passwordHash,
    role: 'ENTREPRENEUR',
    city: input.city.trim(),
    locale,
    pendingBooking: carry,
  });

  // Email is the primary channel for this flow; WhatsApp/SMS stay available via
  // the resend switcher on the OTP page.
  //
  // AWAITED: unawaited it was dropped on Vercel, leaving the visitor waiting for
  // a code that never left. Self-catching, so a mail failure cannot fail the
  // request that already created the pending record.
  await sendOtpEmail(email, otpCode);

  return json(
    { userId: id, maskedEmail: maskEmail(email), maskedPhone: maskPhone(phone) },
    { status: 201 },
  );
}
