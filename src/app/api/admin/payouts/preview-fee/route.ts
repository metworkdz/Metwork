/**
 * POST /api/admin/payouts/preview-fee — preview the SlickPay fee for an amount
 * before sending. Admin only. The beneficiary receives the full amount; the fee
 * is the platform's cost.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { previewTransfer } from '@/server/payouts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ amount: z.number().int().positive() });

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await previewTransfer(input.amount);
  if (!result.ok) {
    return jsonError(422, 'BELOW_MINIMUM', `Minimum payout is ${result.minimum.toLocaleString()} DZD.`, { minimum: result.minimum });
  }

  return json({ amount: result.amount, fee: result.fee, beneficiaryReceives: result.beneficiaryReceives });
}
