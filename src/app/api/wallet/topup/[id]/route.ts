/**
 * GET /api/wallet/topup/:id
 *
 * Status check for a previously-initiated top-up. Used by the frontend
 * to poll while waiting for the webhook (async providers).
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { getTopUp } from '@/server/wallet/service';
import { json, jsonError } from '@/server/http/json';
import type { TopUpStatusResponse } from '@/types/wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const intent = await getTopUp(id);
  if (!intent || intent.userId !== guard.user.id) {
    return jsonError(404, 'NOT_FOUND', 'Top-up not found');
  }

  const response: TopUpStatusResponse = {
    topUpId: intent.id,
    status: intent.status,
    amount: intent.amount,
    provider: intent.provider,
    redirectUrl: intent.redirectUrl,
    transactionId: intent.transactionId,
  };
  return json(response);
}
