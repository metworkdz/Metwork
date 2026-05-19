/**
 * POST /api/mentors/:id/book
 * Submit a consultation booking request for a specific mentor.
 * Requires authentication.
 *
 * Status flow:
 *   PENDING → admin reviews → APPROVED (confirmation email sent) | REJECTED
 *
 * This route only creates the PENDING request and notifies the admin.
 * Approval/rejection is handled by PATCH /api/admin/mentor-bookings/:id.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type MentorConsultationRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendConsultationRequestReceivedEmail, sendAdminConsultationNotification } from '@/server/notifications/mock';
import { validatePromoCode, promoAppliesToType, consumePromoCode } from '@/server/promo-codes/service';
import { getEffectiveMembershipCode, getUserConsultationQuota } from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ADVANCE_HOURS = 24;

const schema = z.object({
  name:    z.string().min(2).max(120),
  email:   z.string().email().max(200),
  phone:   z.string().min(6).max(30),
  message: z.string().min(10).max(1000),
  /** Requested date for the consultation (YYYY-MM-DD) */
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Requested start time (HH:MM) */
  consultationTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  /**
   * Full ISO datetime (with timezone offset) representing the consultation
   * start. Sent by the client so the 24-hour guard isn't subject to UTC
   * off-by-one-day errors near midnight. When provided, takes precedence
   * over `consultationDate` + `consultationTime` for the advance check.
   */
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  /** Duration in minutes: 30 | 60 | 90 | 120 | 150 | 180 */
  durationMinutes: z.number().int().min(30).max(180).optional().nullable(),
  /** Optional promo code string */
  promoCode: z.string().max(50).optional().nullable(),
  /**
   * If true (and the user still has free quota this month), the booking is
   * recorded as FREE_QUOTA and a corresponding mentorConsultations row is
   * written so the credit is consumed. Server is authoritative — sends 0 if
   * the user has no remaining quota.
   */
  useFreeCredit: z.boolean().optional(),
});

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

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

  // Enforce 24-hour advance booking only when a date is supplied. Prefer the
  // client-provided full ISO `scheduledAt` (carries the timezone offset) over
  // the legacy `consultationDate` + `consultationTime` pair so users near
  // midnight aren't rejected by spurious UTC date shifts.
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

  // Validate promo code if provided
  let discountPercent = 0;
  let appliedPromoCode: string | null = null;

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
    discountPercent  = validation.discountPercent;
    appliedPromoCode = validation.promoCode.code;
  }

  // Server-authoritative pricing — never trust the client.
  const effectiveCode = getEffectiveMembershipCode(guard.user);
  const discountFraction =
    effectiveCode === 'STARTUP' ? 0.20 :
    effectiveCode === 'ENTREPRENEUR' ? 0.15 :
    0;

  const quota = await getUserConsultationQuota(guard.user.id);
  const useFree = input.useFreeCredit === true && quota.remaining > 0;

  // Base price = (duration / 60) * hourly fee.  When no duration is supplied,
  // assume 60 minutes for the indicative amount stored on the booking.
  const feePerHour = mentor.consultationFee ?? 0;
  const effectiveMinutes = input.durationMinutes ?? 60;
  const basePrice = feePerHour > 0
    ? Math.round((effectiveMinutes / 60) * feePerHour)
    : 0;

  const tierDiscountAmt = useFree ? 0 : Math.round(basePrice * discountFraction);
  const afterTier = useFree ? 0 : Math.max(0, basePrice - tierDiscountAmt);

  // Apply promo on top of tier discount (mirrors the client breakdown).
  const promoDiscountAmt = !useFree && discountPercent > 0
    ? Math.round(afterTier * discountPercent / 100)
    : 0;
  const finalPrice = useFree ? 0 : Math.max(0, afterTier - promoDiscountAmt);

  const now = new Date().toISOString();
  const quotaMonth = currentQuotaMonth();

  const bookingId = randomUUID();
  const booking = await db.update((d) => {
    const record = {
      id:                   bookingId,
      mentorId,
      userId:               guard.user.id,
      userName:             input.name,
      userEmail:            input.email,
      userPhone:            input.phone,
      message:              input.message,
      consultationDate:     input.consultationDate ?? null,
      consultationTime:     input.consultationTime ?? null,
      durationMinutes:      input.durationMinutes  ?? null,
      status:               'PENDING' as const,
      adminNote:            null,
      appliedPromoCode:     appliedPromoCode ?? null,
      promoDiscountPercent: discountPercent > 0 ? discountPercent : null,
      chargeType:           useFree ? ('FREE_QUOTA' as const) : ('PAID' as const),
      discountFraction:     useFree ? 0 : discountFraction,
      freeQuotaMonth:       useFree ? quotaMonth : null,
      amountCharged:        finalPrice,
      createdAt:            now,
      updatedAt:            now,
    };
    if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
    d.mentorBookings.push(record);

    // If using a free credit, also write a mentorConsultations row so the
    // monthly quota is properly consumed (matches the consult-route pattern).
    if (useFree) {
      if (!Array.isArray(d.mentorConsultations)) d.mentorConsultations = [];
      const consultation: MentorConsultationRecord = {
        id:             randomUUID(),
        bookingId,
        mentorId,
        mentorName:     mentor.fullName,
        userId:         guard.user.id,
        chargeType:     'FREE_QUOTA',
        amountCharged:  0,
        transactionId:  null,
        status:         'PENDING',
        quotaMonth,
        message:        input.message,
        durationMinutes: input.durationMinutes ?? null,
        createdAt:      now,
        updatedAt:      now,
      };
      d.mentorConsultations.push(consultation);
    }

    return record;
  });

  // Consume promo code after successful booking creation
  if (appliedPromoCode) {
    await consumePromoCode(appliedPromoCode);
  }

  // 1. Tell the client their request is received and pending review (NOT a confirmation)
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  const lang = user?.locale === 'en' ? 'en' : 'fr';
  sendConsultationRequestReceivedEmail({ booking, mentor, lang });

  // 2. Notify the admin that a new consultation request arrived
  sendAdminConsultationNotification({ booking, mentor, lang });

  return json({
    id:               booking.id,
    status:           booking.status,
    chargeType:       booking.chargeType,
    amountCharged:    booking.amountCharged,
    discountFraction: booking.discountFraction,
    discountPercent,
    appliedPromoCode,
  }, { status: 201 });
}
