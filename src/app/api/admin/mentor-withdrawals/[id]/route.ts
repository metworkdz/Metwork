/**
 * PATCH /api/admin/mentor-withdrawals/[id] — approve or reject a consultant
 * withdrawal request. Admin only. Reuses the existing mentor-ledger resolver
 * (resolveMentorWithdrawal) — no parallel withdrawal system.
 *
 * APPROVED: the external transfer is done; the escrow hold is completed (money
 *           already left AVAILABLE at request time).
 * REJECTED: the held amount is refunded back to the consultant's AVAILABLE
 *           balance.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { resolveMentorWithdrawal } from '@/server/mentors/ledger';
import { processMentorSlickpayPayout } from '@/server/payouts/service';
import { sendWithdrawalProcessedEmail } from '@/server/notifications/mock';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const beneficiarySchema = z.object({
  rib: z.string().min(16).max(40),
  firstname: z.string().min(1).max(120),
  lastname: z.string().min(1).max(120),
  address: z.string().min(1).max(240),
});

const patchSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  /** How an approval is paid out. Defaults to MANUAL (legacy behaviour). */
  method: z.enum(['MANUAL', 'SLICKPAY']).optional(),
  adminNote: z.string().max(500).optional(),
  /** Required when method === 'SLICKPAY'. */
  beneficiary: beneficiarySchema.optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // ── Automated SlickPay disbursement path ──────────────────────────────────
  if (input.status === 'APPROVED' && input.method === 'SLICKPAY') {
    if (!input.beneficiary) {
      return jsonError(400, 'BENEFICIARY_REQUIRED', 'A beneficiary RIB is required for a SlickPay payout.');
    }
    const res = await processMentorSlickpayPayout({
      requestId: id,
      beneficiary: input.beneficiary,
      adminNote: input.adminNote ?? null,
    });
    if (!res.ok) {
      switch (res.reason) {
        case 'NOT_FOUND':          return jsonError(404, 'NOT_FOUND', 'Withdrawal request not found');
        case 'NOT_PENDING':        return jsonError(409, 'ALREADY_RESOLVED', 'Withdrawal request is already resolved');
        case 'ALREADY_PROCESSING': return jsonError(409, 'ALREADY_PROCESSING', 'A SlickPay payout is already in progress for this request.');
        case 'INVALID_RIB':        return jsonError(422, 'INVALID_RIB', 'The RIB must be a valid 20-digit Algerian account number.');
        case 'DISPATCH_FAILED':    return jsonError(502, 'DISPATCH_FAILED', res.message ?? 'SlickPay rejected the payout. It has been marked failed and can be retried.');
      }
    }

    const data = await db.read();
    const updated = (data.mentorWithdrawals ?? []).find((r) => r.id === id);
    const mentor = updated ? (data.mentors ?? []).find((m) => m.id === updated.mentorId) : undefined;

    void appendAuditLog({
      adminId: guard.user.id,
      adminEmail: guard.user.email,
      action: 'WITHDRAWAL_APPROVED',
      targetType: 'mentor_withdrawal',
      targetId: id,
      details: { amount: updated?.amount, mentorId: updated?.mentorId, method: 'SLICKPAY', finalStatus: res.finalStatus },
    });

    if (res.finalStatus === 'SENT' && mentor?.email) {
      sendWithdrawalProcessedEmail(mentor.email, {
        userName: mentor.fullName,
        amount: updated?.amount ?? 0,
        status: 'APPROVED',
        adminNote: input.adminNote,
      });
    }

    return json({ withdrawal: updated, finalStatus: res.finalStatus });
  }

  const result = await resolveMentorWithdrawal({
    id,
    status: input.status,
    adminNote: input.adminNote ?? null,
  });

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Withdrawal request not found');
    if (result.reason === 'ALREADY_RESOLVED') {
      return jsonError(409, 'ALREADY_RESOLVED', 'Withdrawal request is already resolved');
    }
    return jsonError(
      409,
      'WALLET_FROZEN',
      'Cannot reject: the consultant earnings wallet is frozen. Unfreeze it first, then retry.',
    );
  }

  // Audit log (reuses the existing withdrawal actions).
  void appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: input.status === 'APPROVED' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
    targetType: 'mentor_withdrawal',
    targetId: result.request.id,
    details: { amount: result.request.amount, mentorId: result.request.mentorId, adminNote: input.adminNote ?? null },
  });

  // Notify the consultant (fire-and-forget) at their contact email, if any.
  void (async () => {
    try {
      const data = await db.read();
      const mentor = (data.mentors ?? []).find((m) => m.id === result.request.mentorId);
      if (mentor?.email) {
        sendWithdrawalProcessedEmail(mentor.email, {
          userName: mentor.fullName,
          amount: result.request.amount,
          status: input.status,
          adminNote: input.adminNote,
        });
      }
    } catch {
      // non-critical
    }
  })();

  return json({ withdrawal: result.request });
}
