/**
 * POST /api/memberships/purchase
 *
 * Purchase or upgrade a membership plan.
 * Atomically debits the wallet, updates the user record, and appends a
 * UserMembershipRecord.  Supports promo codes (percentage discounts).
 *
 * Body:
 *   { plan: 'ENTREPRENEUR' | 'STARTUP', billingPeriod: 'monthly' | 'yearly', promoCode?: string }
 *
 * Response (201):
 *   { plan, expiresAt, amountCharged, discountApplied }
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { validatePromoCode, consumePromoCode } from '@/server/promo-codes/service';
import { MEMBERSHIP_PRICES } from '@/server/memberships/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  plan: z.enum(['ENTREPRENEUR', 'STARTUP']),
  billingPeriod: z.enum(['monthly', 'yearly']).default('monthly'),
  promoCode: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
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

  // ── Price computation ──────────────────────────────────────────────────────
  const prices = MEMBERSHIP_PRICES[input.plan] ?? { monthly: 0, yearly: 0 };
  const basePrice = input.billingPeriod === 'yearly' ? prices.yearly : prices.monthly;
  const discountAmount = Math.floor((basePrice * discountPercent) / 100);
  const finalPrice = Math.max(0, basePrice - discountAmount);

  // ── Expiry ─────────────────────────────────────────────────────────────────
  const now = new Date();
  const expiresAt = new Date(now);
  if (input.billingPeriod === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }
  const expiresAtIso = expiresAt.toISOString();

  const userId = guard.user.id;

  // ── Atomic DB write ────────────────────────────────────────────────────────
  const result = await db.update((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (!user) return { ok: false, reason: 'USER_NOT_FOUND' } as const;

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
        },
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
      });
    }

    // Mark any previous active membership as superseded
    if (!Array.isArray(d.userMemberships)) d.userMemberships = [];
    d.userMemberships
      .filter((m) => m.userId === userId && m.status === 'ACTIVE')
      .forEach((m) => {
        m.status = 'CANCELLED';
        m.updatedAt = now.toISOString();
      });

    // Create new membership record
    d.userMemberships.push({
      id: randomUUID(),
      userId,
      plan: input.plan,
      startsAt: now.toISOString(),
      expiresAt: expiresAtIso,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    // Update user record
    user.membershipCode = input.plan;
    user.membershipExpiresAt = expiresAtIso;
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
      });
    }
  }

  // Consume the promo code (outside the main critical section — idempotent)
  if (input.promoCode) {
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
