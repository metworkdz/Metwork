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
import {
  db,
  type MentorBookingRecord,
  type MentorConsultationRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendConsultationRequestReceivedEmail, sendAdminConsultationNotification } from '@/server/notifications/mock';
import { validatePromoCode, promoAppliesToType, consumePromoCode } from '@/server/promo-codes/service';
import { getEffectiveMembershipCode, getUserConsultationQuota } from '@/server/memberships/service';
import { track } from '@/lib/analytics';

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
  /**
   * Idempotency key supplied by the client (UUID). When the client retries
   * the same booking (network timeout, double-click), the same key is sent
   * and the server returns the original booking instead of double-charging.
   * Optional for backward compatibility; auto-generated server-side if absent.
   */
  clientReference: z.string().min(8).max(80).optional(),
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
  const clientReference = input.clientReference ?? randomUUID();

  // Inside the critical section we may need to return one of several failure
  // shapes. Wrap in a discriminated union so the caller can branch cleanly.
  type CreateResult =
    | { ok: true; replayed: boolean; booking: MentorBookingRecord }
    | { ok: false; reason: 'INSUFFICIENT_FUNDS'; balance: number; required: number }
    | { ok: false; reason: 'WALLET_FROZEN' };

  const result = await db.update<CreateResult>((d) => {
    if (!Array.isArray(d.mentorBookings))      d.mentorBookings      = [];
    if (!Array.isArray(d.mentorConsultations)) d.mentorConsultations = [];
    if (!Array.isArray(d.transactions))        d.transactions        = [];
    if (!Array.isArray(d.wallets))             d.wallets             = [];

    // Idempotency: same clientReference for the same user → return existing.
    const existing = d.mentorBookings.find(
      (b) => b.userId === guard.user.id && b.clientReference === clientReference,
    );
    if (existing) {
      return { ok: true, replayed: true, booking: existing };
    }

    // ── PAID path: wallet must have funds and not be frozen ──────────────
    if (!useFree && finalPrice > 0) {
      let wallet: WalletRecord | undefined = d.wallets.find((w) => w.userId === guard.user.id);
      if (!wallet) {
        wallet = {
          id: randomUUID(),
          userId: guard.user.id,
          balance: 0,
          currency: 'DZD',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        };
        d.wallets.push(wallet);
      }
      if (wallet.status === 'FROZEN') {
        return { ok: false, reason: 'WALLET_FROZEN' };
      }
      if (wallet.balance < finalPrice) {
        return {
          ok: false,
          reason: 'INSUFFICIENT_FUNDS',
          balance: wallet.balance,
          required: finalPrice,
        };
      }

      // Atomic: debit wallet → write transaction → write booking with txId.
      wallet.balance -= finalPrice;
      wallet.updatedAt = now;
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: guard.user.id,
        type: 'PAYMENT',
        amount: -finalPrice,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Consultation booking — ${mentor.fullName}`,
        reference: clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'CONSULTATION',
          mentorId,
          mentorName: mentor.fullName,
          durationMinutes: input.durationMinutes ?? null,
          appliedPromoCode: appliedPromoCode ?? null,
          promoDiscountPercent: discountPercent || null,
          tierDiscountFraction: discountFraction || null,
        },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);

      const record: MentorBookingRecord = {
        id:                   randomUUID(),
        mentorId,
        userId:               guard.user.id,
        userName:             input.name,
        userEmail:            input.email,
        userPhone:            input.phone,
        message:              input.message,
        consultationDate:     input.consultationDate ?? null,
        consultationTime:     input.consultationTime ?? null,
        durationMinutes:      input.durationMinutes  ?? null,
        status:               'PENDING',
        adminNote:            null,
        appliedPromoCode:     appliedPromoCode ?? null,
        promoDiscountPercent: discountPercent > 0 ? discountPercent : null,
        chargeType:           'PAID',
        discountFraction:     discountFraction,
        freeQuotaMonth:       null,
        amountCharged:        finalPrice,
        transactionId:        tx.id,
        refundTransactionId:  null,
        clientReference,
        createdAt:            now,
        updatedAt:            now,
      };
      d.mentorBookings.push(record);
      return { ok: true, replayed: false, booking: record };
    }

    // ── FREE_QUOTA path (or PAID with finalPrice === 0 due to 100% promo) ─
    const record: MentorBookingRecord = {
      id:                   randomUUID(),
      mentorId,
      userId:               guard.user.id,
      userName:             input.name,
      userEmail:            input.email,
      userPhone:            input.phone,
      message:              input.message,
      consultationDate:     input.consultationDate ?? null,
      consultationTime:     input.consultationTime ?? null,
      durationMinutes:      input.durationMinutes  ?? null,
      status:               'PENDING',
      adminNote:            null,
      appliedPromoCode:     appliedPromoCode ?? null,
      promoDiscountPercent: discountPercent > 0 ? discountPercent : null,
      chargeType:           useFree ? 'FREE_QUOTA' : 'PAID',
      discountFraction:     useFree ? 0 : discountFraction,
      freeQuotaMonth:       useFree ? quotaMonth : null,
      amountCharged:        finalPrice,
      transactionId:        null,
      refundTransactionId:  null,
      clientReference,
      createdAt:            now,
      updatedAt:            now,
    };
    d.mentorBookings.push(record);

    if (useFree) {
      const consultation: MentorConsultationRecord = {
        id:             randomUUID(),
        bookingId:      record.id,
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

    return { ok: true, replayed: false, booking: record };
  });

  // ── Map failure cases to HTTP responses ────────────────────────────────
  if (!result.ok) {
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(
        403,
        'WALLET_FROZEN',
        'Your wallet is currently frozen. Please contact support.',
      );
    }
    if (result.reason === 'INSUFFICIENT_FUNDS') {
      return jsonError(
        402,
        'INSUFFICIENT_FUNDS',
        `Insufficient wallet balance. Required: ${result.required} DZD, available: ${result.balance} DZD.`,
      );
    }
  }

  // From here on, result.ok === true. Replayed requests skip side effects.
  const booking = result.booking;

  // Consume promo code after successful booking creation — but only the first
  // time. Replayed (idempotent) requests must NOT double-consume.
  if (appliedPromoCode && !result.replayed) {
    await consumePromoCode(appliedPromoCode);
  }

  // Emails are side-effects: only fire them on a fresh booking, never on a
  // replayed (idempotent) request. Otherwise a client retry would spam both
  // the user and the admin.
  if (!result.replayed) {
    const data = await db.read();
    const user = data.users.find((u) => u.id === guard.user.id);
    const lang = user?.locale === 'en' ? 'en' : 'fr';
    // 1. Tell the client their request is received and pending review (NOT a confirmation).
    sendConsultationRequestReceivedEmail({ booking, mentor, lang });
    // 2. Notify the admin that a new consultation request arrived.
    sendAdminConsultationNotification({ booking, mentor, lang });

    // Analytics: track consultation creation. We use the same booking_created
    // event as spaces so funnel queries can group by itemKind. Fire-and-forget.
    void track({
      event: 'booking_created',
      distinctId: guard.user.id,
      props: {
        itemKind: 'CONSULTATION',
        amount: finalPrice,
        paymentMethod: 'wallet',
        appliedPromoCode,
      },
    });
  }

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
