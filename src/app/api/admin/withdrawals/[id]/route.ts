/**
 * PATCH /api/admin/withdrawals/[id] — approve or reject a withdrawal request.
 *
 * Withdrawals are settled MANUALLY (bank wire / CCP / cheque done outside the
 * platform). Both actions delegate to the central withdrawal service:
 *   APPROVED — settle the escrow hold (money already moved externally). An
 *              optional receiptUrl (from /api/upload) can be attached.
 *              Idempotent: re-approving an approved request replays as
 *              success without double-debiting or double-emailing.
 *   REJECTED — refund the escrowed amount back to the wallet.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { approveWithdrawal, rejectWithdrawal } from '@/server/withdrawals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  adminNote: z.string().max(500).optional(),
  /** Proof of the manual transfer, uploaded via the existing /api/upload. */
  receiptUrl: z.string().url().max(1000).optional(),
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

  const result =
    input.status === 'APPROVED'
      ? await approveWithdrawal({
          targetType: 'user',
          requestId: id,
          adminId: guard.user.id,
          adminNote: input.adminNote ?? null,
          receiptUrl: input.receiptUrl ?? null,
        })
      : await rejectWithdrawal({
          targetType: 'user',
          requestId: id,
          adminId: guard.user.id,
          reason: input.adminNote ?? null,
        });

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Withdrawal request not found');
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(
        409,
        'WALLET_FROZEN',
        'Cannot reject withdrawal: user wallet is frozen. Unfreeze the wallet first, then retry.',
      );
    }
    return jsonError(409, 'ALREADY_RESOLVED', 'Withdrawal request is already resolved');
  }

  // Audit only real transitions — an idempotent replay changed nothing.
  if (!result.replayed) {
    const r = result.request;
    void appendAuditLog({
      adminId:    guard.user.id,
      adminEmail: guard.user.email,
      action:     input.status === 'APPROVED' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      targetType: 'withdrawal',
      targetId:   r.id,
      details:    {
        amount: r.amount,
        userId: 'userId' in r ? r.userId : undefined,
        method: r.method ?? null,
        adminNote: input.adminNote ?? null,
      },
    });
  }

  return json({ withdrawalRequest: result.request });
}
