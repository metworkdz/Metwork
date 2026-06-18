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
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
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
