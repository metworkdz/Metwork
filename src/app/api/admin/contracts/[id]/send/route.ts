/**
 * POST /api/admin/contracts/:id/send — DRAFT → PENDING_SIGNATURE.
 *
 * The terms freeze here (commission rate, payout route, phone), so this is the
 * point of no return for editing. `sendContract` owns that; this route maps its
 * refusals to HTTP and fires the notification.
 *
 * The notification is NON-BLOCKING and deliberately sent AFTER the transition.
 * The contract is already visible in the consultant's portal by then, so a mail
 * failure must not roll the send back — doing so would leave an admin unable to
 * re-send a contract that had in fact been issued.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { sendContract } from '@/server/consultant-contracts/service';
import { toAdminContractDto } from '@/server/consultant-contracts/dto';
import { sendContractReadyEmail } from '@/server/notifications/mock';
import { clientEnvVars } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await sendContract(id, guard.user.id);

  if (!result.ok) {
    switch (result.reason) {
      case 'NOT_FOUND':
        return jsonError(404, 'NOT_FOUND', 'Contract not found');
      case 'NOT_DRAFT':
        return jsonError(409, 'NOT_DRAFT', 'Only a draft can be sent.');
      case 'EMPTY_CONTENT':
        return jsonError(422, 'EMPTY_CONTENT', 'The contract body is empty.');
      case 'CONSULTANT_NOT_FOUND':
        return jsonError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
      case 'NO_VERIFIED_PHONE':
      default:
        return jsonError(
          409,
          'NO_VERIFIED_PHONE',
          'This consultant has no verified phone number. The signing code is the identity proof behind the signature, so it cannot be sent to an unverified number.',
        );
    }
  }

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === result.contract.consultantId) ?? null;

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_SENT',
    targetType: 'consultant_contract',
    targetId: id,
    details: {
      consultantId: result.contract.consultantId,
      commissionRate: result.contract.commissionRate,
      payoutMethod: result.contract.payoutMethod,
    },
  });

  if (mentor?.email) {
    const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    sendContractReadyEmail(mentor.email, {
      consultantName: mentor.fullName,
      portalUrl: `${base}/mentordashboard`,
    });
  }

  return json({ contract: toAdminContractDto(result.contract, mentor) });
}
