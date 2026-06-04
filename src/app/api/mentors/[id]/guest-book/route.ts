/**
 * POST /api/mentors/:id/guest-book
 *
 * PUBLIC, no session. Lets a visitor with no account request a consultation.
 * NO payment happens here — guests pay online ONLY after an admin approves
 * (see PATCH /api/admin/mentor-bookings/:id and /consultation/pay/[token]).
 *
 * Status flow (guest):
 *   PENDING (paymentStatus UNPAID) → admin approves → AWAITING_PAYMENT
 *     → guest pays via hosted checkout → CONFIRMED
 *
 * Security: rate-limited per-IP, Zod-validated. The promo code (if any) is
 * VALIDATED for applicability but only STORED here — it is re-validated and
 * CONSUMED later, on successful payment. Server is authoritative on pricing;
 * no amount is read from the client.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import {
  sendConsultationRequestReceivedEmail,
  sendAdminConsultationNotification,
} from '@/server/notifications/mock';
import { validatePromoCode, promoAppliesToType } from '@/server/promo-codes/service';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ADVANCE_HOURS = 24;

const schema = z.object({
  name:    z.string().min(2).max(120),
  email:   z.string().email().max(200),
  phone:   z.string().min(6).max(30),
  message: z.string().min(10).max(1000),
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  consultationTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  scheduledAt:      z.string().datetime({ offset: true }).optional().nullable(),
  durationMinutes:  z.number().int().min(30).max(180).optional().nullable(),
  promoCode:        z.string().max(50).optional().nullable(),
  /** Email language hint (templates support en|fr; ar maps to fr). */
  locale:           z.enum(['en', 'fr', 'ar']).optional(),
  /** Client idempotency key — replays return the original guest booking. */
  clientReference:  z.string().min(8).max(80).optional(),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`guest-book:ip:${ip}`, 8, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  const { id: mentorId } = await params;
  const mentor = await findMentorById(mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Mentor not found');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // 24-hour advance guard — only when a concrete slot was chosen. Prefer the
  // client's full ISO scheduledAt (carries timezone offset) over the date/time
  // pair so a near-midnight pick isn't rejected by a spurious UTC date shift.
  const scheduledIso =
    input.scheduledAt ??
    (input.consultationDate && input.consultationTime
      ? `${input.consultationDate}T${input.consultationTime}:00`
      : null);
  if (scheduledIso) {
    const scheduled = new Date(scheduledIso);
    if (Number.isNaN(scheduled.getTime())) {
      return jsonError(422, 'INVALID_DATE', 'Invalid consultation date/time');
    }
    if (scheduled.getTime() - Date.now() < MIN_ADVANCE_HOURS * 60 * 60 * 1000) {
      return jsonError(422, 'TOO_SOON', `Consultations must be booked at least ${MIN_ADVANCE_HOURS} hours in advance`);
    }
  }

  // Validate (but never consume) the promo code so the guest gets early
  // feedback. It is re-validated and consumed only on successful payment.
  let appliedPromoCode: string | null = null;
  let promoDiscountPercent: number | null = null;
  if (input.promoCode && input.promoCode.trim()) {
    const validation = await validatePromoCode(input.promoCode.trim());
    if (!validation.valid) {
      const msgs: Record<string, string> = {
        NOT_FOUND:     'Promo code not found',
        INACTIVE:      'Promo code is no longer active',
        EXPIRED:       'Promo code has expired',
        LIMIT_REACHED: 'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msgs[validation.reason] ?? 'Invalid promo code');
    }
    if (!promoAppliesToType(validation.promoCode, 'CONSULTATION')) {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to consultations');
    }
    appliedPromoCode     = validation.promoCode.code;
    promoDiscountPercent = validation.discountPercent > 0 ? validation.discountPercent : null;
  }

  const now = new Date().toISOString();
  const clientReference = input.clientReference ?? randomUUID();

  const result = await db.update<{ replayed: boolean; booking: MentorBookingRecord }>((d) => {
    if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];

    // Idempotency: a guest retry with the same clientReference replays.
    const existing = d.mentorBookings.find(
      (b) => b.source === 'guest' && b.clientReference === clientReference,
    );
    if (existing) return { replayed: true, booking: existing };

    const record: MentorBookingRecord = {
      id:                   randomUUID(),
      mentorId,
      userId:               null,
      userName:             input.name,
      userEmail:            input.email,
      userPhone:            input.phone,
      message:              input.message,
      consultationDate:     input.consultationDate ?? null,
      consultationTime:     input.consultationTime ?? null,
      durationMinutes:      input.durationMinutes  ?? null,
      scheduledAt:          input.scheduledAt ?? null,
      status:               'PENDING',
      adminNote:            null,
      appliedPromoCode,
      promoDiscountPercent,
      chargeType:           'PAID',
      transactionId:        null,
      refundTransactionId:  null,
      clientReference,
      // ── guest flow ──
      source:               'guest',
      paymentStatus:        'UNPAID',
      payToken:             null,
      payTokenExpiresAt:    null,
      paymentProviderRef:   null,
      guestAmountDue:       null,
      confirmationEmailSentAt: null,
      guestLocale:          input.locale ?? 'fr',
      createdAt:            now,
      updatedAt:            now,
    };
    d.mentorBookings.push(record);
    return { replayed: false, booking: record };
  });

  const booking = result.booking;

  // Side effects only on a fresh request — replays stay silent.
  if (!result.replayed) {
    const lang: 'en' | 'fr' = input.locale === 'en' ? 'en' : 'fr';
    // Tell the guest the request was received (NOT confirmed, NOT a pay link yet).
    sendConsultationRequestReceivedEmail({ booking, mentor, lang });
    // Notify the admin a new request needs review.
    sendAdminConsultationNotification({ booking, mentor, lang });

    void track({
      event: 'booking_created',
      distinctId: booking.id,
      props: { itemKind: 'CONSULTATION', amount: 0, paymentMethod: 'manual', appliedPromoCode: null },
    });
  }

  return json(
    { id: booking.id, status: booking.status, source: 'guest' },
    { status: 201 },
  );
}
