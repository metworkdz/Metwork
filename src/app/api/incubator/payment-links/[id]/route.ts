/**
 * POST /api/incubator/payment-links/:id  — cancel a payment link.
 *
 * Incubator-only. A link can be cancelled only while it has NOT been PAID.
 * Ownership is enforced server-side (the link must belong to the caller's
 * incubator). Idempotent: cancelling an already-cancelled link succeeds.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { cancelPaymentLink } from '@/server/payments/payment-links';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.literal('cancel') });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  try { schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await cancelPaymentLink(id, inc.id);
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Payment link not found');
    return jsonError(409, 'ALREADY_PAID', 'A paid payment link cannot be cancelled');
  }
  return json(result.link);
}
