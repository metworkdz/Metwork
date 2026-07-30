/**
 * GET /api/consultations/quote?mentorId=&durationMinutes=&promoCode=
 *
 * Server-computed price for a prospective consultation, plus which payment
 * rails are currently offerable. Exists so the checkout UI never derives money
 * itself: it renders what this returns.
 *
 * Read-only — creates nothing, consumes no promo code, moves no money. The
 * booking endpoint recomputes the amount from scratch anyway, so a stale or
 * tampered quote can never influence what is actually charged.
 *
 * Deliberately returns `amountEur` but NOT the exchange rate: the rate is an
 * internal pricing input and is never exposed to a client.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { isMentorApproved } from '@/lib/mentor-approval';
import { computeConsultationCharge } from '@/server/consultations/pricing';
import { validatePromoCode, promoAppliesToType } from '@/server/promo-codes/service';
import {
  getEffectiveMembershipCode,
  consultationDiscountFraction,
} from '@/server/memberships/service';
import { getInternationalCardAvailability } from '@/server/payments/exchange-rate';
import { convertDzdToEur, FxError } from '@/server/payments/fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const mentorId = params.get('mentorId');
  const durationMinutes = Number(params.get('durationMinutes'));
  const promoCodeRaw = params.get('promoCode')?.trim() ?? '';

  if (!mentorId) return jsonError(400, 'MISSING_PARAM', 'Query param "mentorId" is required');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 180) {
    return jsonError(422, 'INVALID_DURATION', 'durationMinutes must be an integer between 30 and 180');
  }

  const mentor = await findMentorById(mentorId);
  if (!mentor || !isMentorApproved(mentor)) {
    return jsonError(404, 'NOT_FOUND', 'Mentor not found');
  }

  // Applicability only — never consumed here.
  let promoDiscountPercent = 0;
  if (promoCodeRaw) {
    const validation = await validatePromoCode(promoCodeRaw);
    if (validation.valid && promoAppliesToType(validation.promoCode, 'CONSULTATION')) {
      promoDiscountPercent = validation.discountPercent;
    }
  }

  const charge = computeConsultationCharge({
    feePerHour: mentor.consultationFee ?? 0,
    durationMinutes,
    membershipDiscountFraction: consultationDiscountFraction(
      getEffectiveMembershipCode(guard.user),
    ),
    promoDiscountPercent,
  });

  // Wallet balance is informational: it decides whether the wallet option is
  // preselected, never whether a card is allowed. The wallet is optional.
  const data = await db.read();
  const walletBalance = data.wallets?.find((w) => w.userId === guard.user.id)?.balance ?? 0;

  // International card: available only when Stripe is configured AND a rate is
  // set AND the converted amount clears the card minimum.
  const availability = await getInternationalCardAvailability();
  let amountEur: number | null = null;
  let stripeAvailable = availability.available;
  if (stripeAvailable && charge.gross > 0) {
    try {
      amountEur = convertDzdToEur(charge.gross, availability.rate).amountEur;
    } catch (err) {
      if (err instanceof FxError) {
        // e.g. below the €0.50 floor — hide the option rather than offering a
        // checkout that would fail after the user committed to it.
        stripeAvailable = false;
      } else {
        throw err;
      }
    }
  }

  return json({
    amountDzd: charge.gross,
    basePrice: charge.basePrice,
    tierDiscountAmount: charge.tierDiscountAmount,
    promoDiscountAmount: charge.promoDiscountAmount,
    appliedSource: charge.appliedSource,
    walletBalance,
    walletCovers: walletBalance >= charge.gross,
    methods: {
      // The wallet is offered whenever it can cover the amount; it is never
      // forced and never auto-debited.
      WALLET: charge.gross > 0 && walletBalance >= charge.gross,
      SLICKPAY: charge.gross > 0,
      STRIPE: stripeAvailable && charge.gross > 0,
    },
    // Display value for the "≈ €X" line under the DZD total. The rate that
    // produced it is intentionally absent.
    amountEur,
  });
}
