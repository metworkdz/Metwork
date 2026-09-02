/**
 * POST /api/bookings  — create a space booking
 *
 * Atomically debits the caller's wallet and writes the booking record.
 * Idempotent on `clientReference` — the same key always returns the same
 * booking, so retries / double-clicks never double-charge.
 *
 * GET /api/bookings  — list the caller's bookings (newest first)
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession, requireApprovedApiSession } from '@/server/auth/api-guards';
import { createSpaceBookingSchema } from '@/server/bookings/schemas';
import { createSpaceBooking, listBookingsForUser } from '@/server/bookings/service';
import { toBookingDto } from '@/server/bookings/serialize';
import { toTransactionDto, toWalletDto } from '@/server/wallet/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { findIncubatorById } from '@/server/incubator/service';
import {
  sendBookingReceiptEmail,
  sendAdminOrderNotification,
  sendBookingConfirmedWithQrEmail,
  sendBookingRequestReceivedEmail,
  sendIncubatorBookingRequestEmail,
  notifyIncubatorNewBooking,
} from '@/server/notifications/mock';
import { createNotification } from '@/server/notifications/create-notification';
import { validatePromoCode } from '@/server/promo-codes/service';
import { getSpaceDiscountForUser } from '@/server/memberships/service';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiSession();
  if (!guard.ok) return guard.response;

  // Rate limit: 30 bookings per hour per authenticated user. Legitimate
  // users rarely create more than a handful per session; this cap stops
  // a compromised account / runaway script from spamming bookings and
  // burning wallet balance. The idempotency key on clientReference handles
  // honest retries, so this limit is for malicious / runaway-script traffic.
  if (!(await checkRateLimitDistributed(`bookings:user:${guard.user.id}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many bookings in a short period. Please wait a moment.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = createSpaceBookingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // ── Membership discount (STARTUP tier gets 20% off spaces) ───────────────
  const membershipDiscount = await getSpaceDiscountForUser(guard.user.id);

  // ── Promo code early validation (before the DB write) ───────────────────
  if (input.promoCode) {
    const promoResult = await validatePromoCode(input.promoCode);
    if (!promoResult.valid) {
      const msg: Record<string, string> = {
        NOT_FOUND: 'Promo code not found',
        INACTIVE: 'Promo code is no longer active',
        EXPIRED: 'Promo code has expired',
        LIMIT_REACHED: 'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msg[promoResult.reason] ?? 'Invalid promo code');
    }
    if (promoResult.promoCode.appliesTo !== 'ALL' && promoResult.promoCode.appliesTo !== 'SPACE') {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to space bookings');
    }
  }

  const result = await createSpaceBooking({
    booker: { type: 'user', userId: guard.user.id },
    spaceId: input.spaceId,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    clientReference: input.clientReference,
    promoCode: input.promoCode,
    paymentMethod: input.paymentMethod,
    membershipDiscount,
    deskName: input.deskName,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'SPACE_NOT_FOUND':
        return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
      case 'UNIT_NOT_AVAILABLE':
        return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', {
          available: result.available,
        });
      case 'DATE_UNAVAILABLE':
        return jsonError(422, 'DATE_UNAVAILABLE', 'The selected date(s) are not available for booking', {
          blockedDates: result.blockedDates,
        });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'Capacity exceeded', {
          capacity: result.capacity,
          taken: result.taken,
        });
      case 'WALLET_FROZEN':
        return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
      case 'INSUFFICIENT_FUNDS':
        return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
          balance: result.balance,
          required: result.required,
        });
      case 'OUTSIDE_WORKING_HOURS':
        return jsonError(422, 'OUTSIDE_WORKING_HOURS',
          `Booking must be between ${result.openingTime} and ${result.closingTime}`, {
            openingTime: result.openingTime,
            closingTime: result.closingTime,
          });
      case 'NOT_A_WORKING_DAY':
        return jsonError(422, 'NOT_A_WORKING_DAY', 'Selected day is not a working day', {
          workingDays: result.workingDays,
        });
      case 'OVERLAP_CONFLICT':
        return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked', {
          conflictingBookingId: result.conflictingBookingId,
        });
      case 'NETWORK_PASS_DISABLED':
        return jsonError(403, 'NETWORK_PASS_DISABLED',
          'Network Pass is not available yet.');
      case 'NOT_PARTNER_SPACE':
        return jsonError(422, 'NOT_PARTNER_SPACE',
          'This space is not part of the Network Pass partner network.');
      case 'NO_CREDITS':
        return jsonError(422, 'NO_CREDITS',
          'You have no Network Pass credits remaining this month.', {
            creditsRemaining: result.creditsRemaining,
          });
      case 'TIER_NOT_ELIGIBLE':
        return jsonError(403, 'TIER_NOT_ELIGIBLE',
          result.tier === 'EXPLORER'
            ? 'Network Pass requires a paid membership.'
            : 'Your plan does not include Network Pass credits.', {
            tier: result.tier,
          });
      // Consultant-only reasons — unreachable from this platform-user route,
      // but kept so the switch stays exhaustive over the shared result union.
      case 'CONSULTANT_CASH_ONLY':
      case 'CASH_NOT_ACCEPTED':
        return jsonError(422, result.reason, 'This payment option is not available for this booking');
    }
  }

  // Send receipt email on first successful booking only (idempotency guard via replayed flag)
  const notifyAfterCreate = !result.replayed
    ? (async () => {
      try {
        const data  = await db.read();
        const user  = data.users.find((u) => u.id === guard.user.id);
        if (!user) return;

        // Find the incubator via the space record
        const space = (data.spaces ?? []).find((s) => s.id === input.spaceId);
        const incubator = space ? await findIncubatorById(space.incubatorId) : null;
        if (!incubator) return;

        const lang = user.locale === 'en' ? 'en' : user.locale === 'ar' ? 'ar' : 'fr';

        if (result.booking.status === 'AWAITING_APPROVAL') {
          // REQUEST mode: no money moved — send "request sent" to the client
          // and "request awaiting approval" (email + in-app) to the incubator
          // instead of a payment receipt.
          const details = {
            bookingId:   result.booking.id,
            itemName:    result.booking.itemName,
            vendorName:  result.booking.vendorName,
            startsAt:    result.booking.startsAt,
            endsAt:      result.booking.endsAt,
            totalAmount: result.booking.totalAmount,
          };
          await sendBookingRequestReceivedEmail(user.email, {
            customerName: user.fullName,
            details,
            lang,
          });
          await sendIncubatorBookingRequestEmail(incubator, {
            customerName: user.fullName,
            details,
            lang: 'fr',
          });
          if (incubator.managerId) {
            await createNotification({
              userId: incubator.managerId,
              type: 'GENERAL',
              title: 'New booking request',
              body: `${user.fullName} requested to book "${result.booking.itemName}". Approve or decline in your bookings dashboard.`,
              href: '/dashboard/incubator/bookings',
            });
          }
        } else {
          await sendBookingReceiptEmail({
            booking:     result.booking,
            clientName:  user.fullName,
            clientEmail: user.email,
            incubator,
            lang: lang === 'ar' ? 'fr' : lang,
          });

          // INSTANT mode auto-confirms with no approval step, so the
          // "confirmed" email (QR + receipt) is sent at creation time —
          // the incubator PATCH that normally sends it never runs.
          if (result.booking.reservationMode === 'INSTANT' && result.booking.status === 'CONFIRMED') {
            await sendBookingConfirmedWithQrEmail(user.email, {
              customerName: user.fullName,
              bookingId:    result.booking.id,
              itemName:     result.booking.itemName,
              itemKind:     result.booking.itemKind,
              vendorName:   result.booking.vendorName,
              city:         result.booking.city,
              startsAt:     result.booking.startsAt,
              endsAt:       result.booking.endsAt,
              totalAmount:  result.booking.totalAmount,
              createdAt:    result.booking.createdAt,
            });
          }

          // Incubator alert (email + WhatsApp) — INSTANT/NETWORK_PASS bookings
          // land CONFIRMED (FYI only); cash (PENDING_PAYMENT) and legacy-escrow
          // (PENDING) bookings still need the incubator to confirm / collect
          // payment via the incubator/bookings dashboard.
          void notifyIncubatorNewBooking(incubator, {
            customerName: user.fullName,
            itemName:     result.booking.itemName,
            startsAt:     result.booking.startsAt,
            endsAt:       result.booking.endsAt,
            totalAmount:  result.booking.totalAmount,
            actionNeeded: result.booking.status !== 'CONFIRMED',
            lang: 'fr',
          });
        }

        // Notify admin of new booking (or new booking request)
        const paymentLabel =
          result.booking.status === 'AWAITING_APPROVAL' ? 'Demande (paiement après approbation)'
          : result.booking.paymentMethod === 'wallet' ? 'En ligne (portefeuille)'
          : result.booking.paymentMethod === 'manual' ? 'Espèces sur place'
          : result.booking.paymentMethod === 'NETWORK_PASS' ? 'Network Pass'
          : result.booking.paymentMethod ?? '—';
        await sendAdminOrderNotification({
          orderKind:     'SPACE',
          customerName:  user.fullName,
          customerEmail: user.email,
          itemName:      result.booking.itemName,
          vendorName:    incubator.name,
          amount:        result.booking.totalAmount,
          reference:     result.booking.clientReference,
          paymentMethod: paymentLabel,
        });
      } catch { /* receipt errors must never break the booking response */ }
    })()
    : null;
  // REQUEST bookings: AWAIT delivery — a serverless lambda can freeze right
  // after the response, dropping void-fired work, and the incubator's
  // "new request" email/notification is what drives the approval flow.
  // Legacy paths keep their original fire-and-forget timing untouched.
  if (notifyAfterCreate) {
    if (result.booking.status === 'AWAITING_APPROVAL') await notifyAfterCreate;
    else void notifyAfterCreate;
  }

  // Analytics: only fire on NEW bookings, never on idempotent replays —
  // otherwise the same booking would inflate the funnel count every time
  // a flaky network retries the request.
  if (!result.replayed) {
    // Coerce paymentMethod to the analytics enum — booking.paymentMethod
    // can be widened by future additions, but the event schema is a fixed
    // union. Map anything unknown to 'wallet' which is the safe default.
    const pm = result.booking.paymentMethod;
    const paymentMethod: 'wallet' | 'manual' | 'NETWORK_PASS' =
      pm === 'manual' || pm === 'NETWORK_PASS' ? pm : 'wallet';
    void track({
      event: 'booking_created',
      distinctId: guard.user.id,
      props: {
        itemKind: 'SPACE',
        amount: result.booking.totalAmount,
        paymentMethod,
        appliedPromoCode: input.promoCode ?? null,
      },
    });
  }

  return json(
    {
      booking: toBookingDto(result.booking),
      transaction: toTransactionDto(result.transaction),
      wallet: toWalletDto(result.wallet),
      replayed: result.replayed,
    },
    { status: result.replayed ? 200 : 201 },
  );
}

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const bookings = await listBookingsForUser(guard.user.id);
  return json({
    items: bookings.map(toBookingDto),
    total: bookings.length,
  });
}
