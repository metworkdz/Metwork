/**
 * GET  /api/consultant/withdrawals — the consultant's withdrawal requests.
 * POST /api/consultant/withdrawals — request a payout against AVAILABLE balance.
 *
 * The escrow hold + admin approve/reject reuse the parallel mentor ledger.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requireConsultant } from '@/server/mentors/access';
import { MIN_MENTOR_WITHDRAWAL } from '@/server/mentors/ledger';
import { createWithdrawalRequest } from '@/server/withdrawals/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    amount: z.number().int().min(MIN_MENTOR_WITHDRAWAL).max(1_000_000),
    /** How the consultant wants the funds. Absent = legacy free-text request. */
    method: z.enum(['bank_transfer', 'ccp', 'cheque']).optional(),
    /** Legacy free-text payment details. Required when no method is given. */
    accountDetails: z.string().min(5).max(500).optional(),
  })
  .refine((v) => v.method !== undefined || v.accountDetails !== undefined, {
    message: 'Either method or accountDetails is required',
    path: ['method'],
  });

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = (data.mentorWithdrawals ?? [])
    .filter((w) => w.mentorId === guard.mentorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  if (!(await checkRateLimitDistributed(`consultant-withdraw:${guard.mentorId}`, 5, 24 * 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'You have reached the daily withdrawal-request limit. Please try again tomorrow.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await createWithdrawalRequest({
    targetType: 'mentor',
    targetId: guard.mentorId,
    amount: input.amount,
    method: input.method ?? null,
    legacyAccountDetails: input.accountDetails,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'WALLET_FROZEN':
        return jsonError(409, 'WALLET_FROZEN', 'Your earnings wallet is frozen. Please contact support.');
      case 'BELOW_MINIMUM':
        return jsonError(422, 'BELOW_MINIMUM', `Minimum withdrawal is ${result.minimum} DZD.`);
      case 'NO_PAYOUT_ACCOUNT':
        return jsonError(
          422,
          'NO_PAYOUT_ACCOUNT',
          result.requiredType === 'bank'
            ? 'Add a bank payout account (RIB) before requesting a bank transfer.'
            : 'Add a CCP payout account (RIP) before requesting a CCP transfer.',
          { requiredType: result.requiredType },
        );
      case 'INSUFFICIENT_FUNDS':
        return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient available balance', { available: result.available, required: result.required });
      default:
        return jsonError(422, 'INVALID_REQUEST', 'Invalid withdrawal request');
    }
  }

  return json({ withdrawal: result.request }, { status: 201 });
}
