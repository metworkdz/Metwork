/**
 * GET /api/payout-account — the caller's saved payout account (or null).
 * PUT /api/payout-account — create/replace it (RIB for bank, RIP for ccp;
 *                           both exactly 20 digits, validated centrally in
 *                           src/server/withdrawals/service.ts).
 *
 * The account is the destination for bank/ccp withdrawal requests; it is
 * snapshotted onto each request at creation time, so editing it never
 * affects in-flight withdrawals.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { setPayoutAccount } from '@/server/withdrawals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putSchema = z.object({
  accountType: z.enum(['bank', 'ccp']),
  accountNumber: z.string().min(10).max(40),
  holderName: z.string().min(2).max(120),
});

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  return json({ payoutAccount: user?.payoutAccount ?? null });
}

export async function PUT(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  if (!(await checkRateLimitDistributed(`payout-account:user:${guard.user.id}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many updates. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = putSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await setPayoutAccount({
    targetType: 'user',
    targetId: guard.user.id,
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
