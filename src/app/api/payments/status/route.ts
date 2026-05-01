/**
 * GET /api/payments/status?id={topUpId}
 *
 * Verifies a pending top-up by polling SlickPay directly.
 * Idempotent — safe to call multiple times for the same topUpId.
 *
 * Flow:
 *   1. Look up TopUpIntent by topUpId, assert it belongs to the caller.
 *   2. If already COMPLETED → return immediately (no re-credit).
 *   3. If PENDING → call SlickPay GET /users/transfers/:providerRef.
 *   4. If completed=1 → call confirmTopUp (credits wallet atomically).
 *   5. Return { completed, balance }.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { confirmTopUp, getTopUp } from '@/server/wallet/service';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const topUpId = req.nextUrl.searchParams.get('id');
  if (!topUpId) return jsonError(400, 'MISSING_PARAM', 'Query param "id" is required');

  const intent = await getTopUp(topUpId);
  if (!intent) return jsonError(404, 'TOPUP_NOT_FOUND', 'Top-up not found');

  // Prevent one user from probing another user's payment.
  if (intent.userId !== guard.user.id) {
    return jsonError(403, 'FORBIDDEN', 'Top-up does not belong to this user');
  }

  // Already settled — return cached result (prevents double-credit on re-poll).
  if (intent.status === 'COMPLETED') {
    return json({ completed: 1, status: 'COMPLETED', topUpId });
  }
  if (intent.status === 'FAILED') {
    return json({ completed: 0, status: 'FAILED', topUpId });
  }

  // PENDING — ask SlickPay for the live status.
  if (!intent.providerRef) {
    return json({ completed: 0, status: 'PENDING', topUpId });
  }

  let slickPayStatus: { completed: 0 | 1 };
  try {
    slickPayStatus = await getSlickPayTransferStatus(intent.providerRef);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      // Running with mock provider or missing key — treat as not yet confirmed.
      return json({ completed: 0, status: 'PENDING', topUpId });
    }
    throw err;
  }

  if (slickPayStatus.completed !== 1) {
    return json({ completed: 0, status: 'PENDING', topUpId });
  }

  // SlickPay confirms payment — settle the wallet. confirmTopUp is fully
  // idempotent: replaying it for an already-COMPLETED intent is a no-op.
  const settled = await confirmTopUp({
    topUpId: intent.id,
    providerRef: intent.providerRef,
    status: 'COMPLETED',
  });

  if (!settled.ok) {
    return jsonError(500, 'CONFIRM_FAILED', 'Failed to settle top-up');
  }

  return json({
    completed: 1,
    status: 'COMPLETED',
    topUpId,
    balance: settled.wallet?.balance ?? null,
  });
}
