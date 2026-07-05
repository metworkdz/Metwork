/**
 * GET /api/consultant/payout-account — the consultant's saved payout account.
 * PUT /api/consultant/payout-account — create/replace it. Mirrors the user
 * route (/api/payout-account) on the isolated consultant session; validation
 * is central in src/server/withdrawals/service.ts.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { setPayoutAccount } from '@/server/withdrawals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  accountType: z.enum(['bank', 'ccp']),
  accountNumber: z.string().min(10).max(40),
  holderName: z.string().min(2).max(120),
});

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === guard.mentorId);
  return json({ payoutAccount: mentor?.payoutAccount ?? null });
}

export async function PUT(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  if (!(await checkRateLimitDistributed(`payout-account:mentor:${guard.mentorId}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many updates. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = putSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await setPayoutAccount({
    targetType: 'mentor',
    targetId: guard.mentorId,
    account: input,
  });

  if (!result.ok) {
    if (result.reason === 'INVALID_ACCOUNT_NUMBER') {
      return jsonError(422, 'INVALID_ACCOUNT_NUMBER', 'The account number must be exactly 20 digits.');
    }
    if (result.reason === 'INVALID_HOLDER_NAME') {
      return jsonError(422, 'INVALID_HOLDER_NAME', 'Enter the account holder name.');
    }
    return jsonError(404, 'NOT_FOUND', 'Account not found');
  }

  return json({ payoutAccount: result.account });
}
