/**
 * POST /api/memberships/purchase
 *
 * Purchase, upgrade or renew a membership plan.
 * Atomically debits the wallet, updates the user record, and appends a
 * UserMembershipRecord.  Supports promo codes (percentage discounts).
 *
 * Pricing is DB-backed and admin-editable (`membershipPlanConfigs`), with the
 * cycle math coming from the shared `@/lib/billing-cycles` helper. Everything
 * the member is buying — price, discount rates, pass allowance — is FROZEN
 * onto the membership record at this moment, so a later admin price change
 * never reaches back into an active billing period.
 *
 * Idempotent: pass a stable `clientReference` and a retry returns the original
 * membership instead of charging the wallet twice.
 *
 * Body:
 *   { plan: 'ENTREPRENEUR' | 'STARTUP', billingPeriod: 'semesterly' | 'yearly',
 *     promoCode?: string, clientReference?: string }
 *
 * Response (201):
 *   { plan, expiresAt, amountCharged, discountApplied }
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { validatePromoCode, consumePromoCode } from '@/server/promo-codes/service';
import { getPlanConfig, pricesForConfig, passCountFrom } from '@/server/memberships/plan-config';
import { computePeriodEnd } from '@/lib/billing-cycles';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  plan: z.enum(['ENTREPRENEUR', 'STARTUP']),
  billingPeriod: z.enum(['semesterly', 'yearly']).default('semesterly'),
  promoCode: z.string().optional(),
  /** Idempotency key — a retry with the same value never charges twice. */
  clientReference: z.string().min(8).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // ── Promo code validation ──────────────────────────────────────────────────
  let discountPercent = 0;
  let promoCodeId: string | null = null;

  if (input.promoCode) {
    const validation = await validatePromoCode(input.promoCode);
    if (!validation.valid) {
      const msg: Record<string, string> = {
        NOT_FOUND: 'Promo code not found',
        INACTIVE: 'Promo code is no longer active',
        EXPIRED: 'Promo code has expired',
        LIMIT_REACHED: 'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msg[validation.reason] ?? 'Invalid promo code');
    }
    if (validation.promoCode.appliesTo !== 'ALL' && validation.promoCode.appliesTo !== 'MEMBERSHIP') {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to memberships');
    }
    discountPercent = validation.discountPercent;
    promoCodeId = validation.promoCode.id;
  }

  // ── Price computation (admin-editable config, shared cycle math) ───────────
  const planConfig = await getPlanConfig(input.plan);
  if (!planConfig) return jsonError(422, 'UNKNOWN_PLAN', 'Unknown membership plan');
  const prices = pricesForConfig(planConfig);
  const basePrice = input.billingPeriod === 'yearly' ? prices.annual : prices.semesterly;
  const discountAmount = Math.floor((basePrice * discountPercent) / 100);
  const finalPrice = Math.max(0, basePrice - discountAmount);

  // ── Expiry ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const expiresAtIso = computePeriodEnd(
    now.toISOString(),
    input.billingPeriod === 'yearly' ? 'ANNUAL' : 'SEMESTERLY',
    planConfig.semesterlyMonths,
  );

  const userId = guard.user.id;

  // ── Atomic DB write ────────────────────────────────────────────────────────
  const result = await db.update((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (!user) return { ok: false, reason: 'USER_NOT_FOUND' } as const;

    // Idempotency: the same clientReference for the same user returns the
    // original membership and NEVER debits the wallet a second time.
    if (!Array.isArray(d.userMemberships)) d.userMemberships = [];
    if (input.clientReference) {
      const existing = d.userMemberships.find(
        (m) => m.userId === userId && m.clientReference === input.clientReference,
      );
      if (existing) {
        return {
          ok: true,
          plan: existing.plan,
          expiresAt: existing.expiresAt ?? expiresAtIso,
          amountCharged: existing.amountCharged ?? 0,
          discountApplied: 0,
          replayed: true,
        } as const;
      }
    }

    if (finalPrice > 0) {
      let wallet = d.wallets.find((w) => w.userId === userId);
      if (!wallet) {
        wallet = {
          id: randomUUID(),
          userId,
          balance: 0,
          currency: 'DZD' as const,
          status: 'ACTIVE' as const,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        d.wallets.push(wallet);
      }
      if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' } as const;
      if (wallet.balance < finalPrice) {
        return {
          ok: false,
          reason: 'INSUFFICIENT_FUNDS',
          balance: wallet.balance,
          required: finalPrice,
        } as const;
      }

      wallet.balance -= finalPrice;
      wallet.updatedAt = now.toISOString();

      d.transactions.push({
        id: randomUUID(),
        walletId: wallet.id,
        userId,
        type: 'PAYMENT',
        amount: -finalPrice,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Membership — ${input.plan} (${input.billingPeriod})`,
        reference: `membership-${randomUUID()}`,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          membershipPlan: input.plan,
          billingPeriod: input.billingPeriod,
          discountPercent,
          promoCodeId,
          // Frozen at purchase so analytics never has to re-derive a historical
          // price from constants that have since changed.
          basePrice,
          amountCharged: finalPrice,
        },
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
      });
    }

    // Mark any previous active membership as superseded
    d.userMemberships
      .filter((m) => m.userId === userId && m.status === 'ACTIVE')
      .forEach((m) => {
        m.status = 'CANCELLED';
        m.updatedAt = now.toISOString();
      });

    // ── Create new membership record WITH its frozen snapshot ─────────────
    // Everything below is written once and never mutated. A later admin price
    // or benefit change applies to the next purchase, not to this period.
    const creditsMax = passCountFrom(d, input.plan);
    d.userMemberships.push({
      id: randomUUID(),
      userId,
      plan: input.plan,
      startsAt: now.toISOString(),
      expiresAt: expiresAtIso,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      billingPeriod: input.billingPeriod,
      basePrice,
      amountCharged: finalPrice,
      promoDiscountPercent: discountPercent,
      spaceDiscountRate: planConfig.spaceDiscountRate,
      consultationDiscountRate: planConfig.consultationDiscountRate,
      monthlyPassCount: creditsMax,
      snapshotAt: now.toISOString(),
      ...(input.clientReference && { clientReference: input.clientReference }),
    });

    // ── Update user record — set both old code and new tier/credit fields ──
    user.membershipCode      = input.plan;
    user.membershipExpiresAt = expiresAtIso;
    user.membershipStartDate = now.toISOString();

    // Resolve the new-style tier and assign Network Pass credits.
    // The allowance comes from the canonical platform config (Builder 0,
    // Founder 5 by default) — never from a literal in this route.
    const isFounder          = input.plan === 'STARTUP';
    user.membershipTier      = isFounder ? 'FOUNDER' : 'BUILDER';
    user.networkCreditsMax   = creditsMax;
    // A purchase starts a fresh allowance period: grant the full allowance and
    // zero the usage counter. Capping matters now that Builder has 0 passes —
    // a Founder downgrading must not keep redeemable credits.
    user.networkCredits          = creditsMax;
    user.networkPassesUsedThisMonth = 0;

    // Mirror the frozen discount rates onto the user record so the serialized
    // session carries them to client price previews (see toSessionUser).
    user.membershipSpaceDiscountRate        = planConfig.spaceDiscountRate;
    user.membershipConsultationDiscountRate = planConfig.consultationDiscountRate;
    // Reset date = 1st of next calendar month at 00:00 UTC
    const resetDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1, // automatically wraps Dec → Jan+1yr
      1, 0, 0, 0,
    ));
    user.networkCreditsResetDate = resetDate.toISOString();
    user.updatedAt = now.toISOString();

    return {
      ok: true,
      plan: input.plan,
      expiresAt: expiresAtIso,
      amountCharged: finalPrice,
      discountApplied: discountAmount,
    } as const;
  });

  if (!result.ok) {
    if (result.reason === 'USER_NOT_FOUND') return jsonError(404, 'USER_NOT_FOUND', 'User not found');
    if (result.reason === 'WALLET_FROZEN') return jsonError(409, 'WALLET_FROZEN', 'Your wallet is frozen. Contact support.');
    if (result.reason === 'INSUFFICIENT_FUNDS') {
      return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
        balance: result.balance,
        required: result.required,
        // Precomputed so the client renders "top up X" without re-deriving a
        // figure the server is authoritative for.
        shortfall: Math.max(0, result.required - result.balance),
      });
    }
  }

  // Consume the promo code (outside the main critical section — idempotent).
  // Skipped on an idempotent replay: the original request already consumed it,
  // and a retry must not burn a second use off the code's usage limit.
  const replayed = 'replayed' in result && result.replayed === true;
  if (input.promoCode && !replayed) {
    await consumePromoCode(input.promoCode);
  }

  return json(
    {
      plan: result.plan,
      expiresAt: result.expiresAt,
      amountCharged: result.amountCharged,
      discountApplied: result.discountApplied,
    },
    { status: 201 },
  );
}
