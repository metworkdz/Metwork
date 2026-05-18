/**
 * PATCH /api/admin/withdrawals/[id] — approve or reject a withdrawal request
 *
 * APPROVED: admin has transferred funds externally; mark as approved, complete
 *           the hold transaction (no further wallet change — money already gone).
 * REJECTED: refund the escrowed amount back to the user's wallet.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type TransactionRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendWithdrawalProcessedEmail } from '@/server/notifications/mock';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  adminNote: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = patchSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    const request = d.withdrawalRequests.find((r) => r.id === id);
    if (!request) return 'NOT_FOUND';
    if (request.status !== 'PENDING') return 'ALREADY_RESOLVED';

    // Pre-flight check for rejection: if the user's wallet is frozen, we
    // can't issue the refund and the funds would be silently lost. Force
    // the admin to unfreeze first instead of pretending we processed it.
    if (input.status === 'REJECTED') {
      const userWallet = d.wallets.find((w) => w.userId === request.userId);
      if (userWallet && userWallet.status === 'FROZEN') {
        return 'WALLET_FROZEN';
      }
    }

    const now = new Date().toISOString();
    request.status = input.status;
    request.adminNote = input.adminNote;
    request.updatedAt = now;

    if (input.status === 'APPROVED') {
      // Mark the hold transaction as completed
      const holdTx = d.transactions.find((t) => t.id === request.holdTransactionId);
      if (holdTx) {
        holdTx.status = 'COMPLETED';
        holdTx.completedAt = now;
      }
    } else {
      // REJECTED: refund the user's wallet
      const userWallet = d.wallets.find((w) => w.userId === request.userId);
      if (userWallet && userWallet.status !== 'FROZEN') {
        userWallet.balance += request.amount;
        userWallet.updatedAt = now;

        const refundTx: TransactionRecord = {
          id: randomUUID(),
          walletId: userWallet.id,
          userId: request.userId,
          type: 'REFUND',
          amount: request.amount,
          balanceAfter: userWallet.balance,
          status: 'COMPLETED',
          description: `Withdrawal rejected — refund`,
          reference: `withdrawal-refund-${request.id.slice(0, 8)}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { withdrawalRequestId: request.id, adminNote: input.adminNote ?? null },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(refundTx);
        request.refundTransactionId = refundTx.id;

        // Mark the original hold transaction as REVERSED
        const holdTx = d.transactions.find((t) => t.id === request.holdTransactionId);
        if (holdTx) {
          holdTx.status = 'REVERSED';
          holdTx.completedAt = now;
        }
      }
    }

    return request;
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Withdrawal request not found');
  if (result === 'ALREADY_RESOLVED') {
    return jsonError(409, 'ALREADY_RESOLVED', 'Withdrawal request is already resolved');
  }
  if (result === 'WALLET_FROZEN') {
    return jsonError(
      409,
      'WALLET_FROZEN',
      'Cannot reject withdrawal: user wallet is frozen. Unfreeze the wallet first, then retry.',
    );
  }

  // Audit log
  void appendAuditLog({
    adminId:    guard.user.id,
    adminEmail: guard.user.email,
    action:     input.status === 'APPROVED' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
    targetType: 'withdrawal',
    targetId:   result.id,
    details:    { amount: result.amount, userId: result.userId, adminNote: input.adminNote ?? null },
  });

  // Fire-and-forget notification to the user
  void (async () => {
    try {
      const data = await db.read();
      const user = data.users.find((u) => u.id === result.userId);
      if (user) {
        sendWithdrawalProcessedEmail(user.email, {
          userName: user.fullName ?? user.email,
          amount: result.amount,
          status: input.status,
          adminNote: input.adminNote,
        });
      }
    } catch {
      // non-critical
    }
  })();

  return json({ withdrawalRequest: result });
}
