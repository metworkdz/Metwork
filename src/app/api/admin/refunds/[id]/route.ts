/**
 * PATCH /api/admin/refunds/[id] — act on one refund.
 *
 *   accept  — undo the sale on the owner side and decide where the client is paid.
 *   reject  — decline (only before acceptance).
 *   resend  — email a guest a fresh account link.
 *   paid    — the manual transfer was sent; attach receipt / reference.
 *
 * Every action is idempotent: repeating it replays as success and does not
 * move money or send mail twice.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import type { AuditAction } from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { acceptRefund, markRefundPaid, rejectRefund, resendAccountLink } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), adminNote: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('resend') }),
  z.object({
    action: z.literal('paid'),
    receiptUrl: z.string().url().max(1000).optional(),
    transferReference: z.string().trim().max(120).optional(),
    account: z.object({
      accountType: z.enum(['bank', 'ccp']),
      accountNumber: z.string().max(40),
      holderName: z.string().max(120),
    }).optional(),
  }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let input;
  try { input = schema.parse(await req.json()); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  const audit = (action: AuditAction, details: Record<string, unknown>) =>
    void appendAuditLog({
      adminId: guard.user.id, adminEmail: guard.user.email,
      action, targetType: 'refund', targetId: id, details,
    });

  if (input.action === 'accept') {
    const r = await acceptRefund({ id, adminId: guard.user.id, adminNote: input.adminNote });
    if (!r.ok) {
      if (r.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Refund not found');
      if (r.reason === 'NO_CLIENT_EMAIL') return jsonError(409, 'NO_CLIENT_EMAIL', 'This client has no account and no email, so no refund link can be sent');
      if (r.reason === 'WRONG_STATE') return jsonError(409, 'WRONG_STATE', 'This refund can no longer be accepted');
      return jsonError(409, r.reason, 'This payment can no longer be refunded');
    }
    if (!r.replayed) audit('REFUND_ACCEPTED', { amount: r.request.amount, destination: r.request.destination, reversal: r.request.reversal });
    return json({ refund: r.request, replayed: r.replayed });
  }

  if (input.action === 'reject') {
    const r = await rejectRefund({ id, adminId: guard.user.id, reason: input.reason });
    if (!r.ok) return r.reason === 'NOT_FOUND' ? jsonError(404, 'NOT_FOUND', 'Refund not found') : jsonError(409, 'WRONG_STATE', 'Only a request that has not been accepted can be rejected');
    if (!r.replayed) audit('REFUND_REJECTED', { reason: input.reason });
    return json({ refund: r.request, replayed: r.replayed });
  }

  if (input.action === 'resend') {
    const r = await resendAccountLink(id);
    if (!r.ok) {
      if (r.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Refund not found');
      if (r.reason === 'NO_CLIENT_EMAIL') return jsonError(409, 'NO_CLIENT_EMAIL', 'No email on file for this client');
      return jsonError(409, 'WRONG_STATE', 'No account link is pending for this refund');
    }
    return json({ ok: true });
  }

  const r = await markRefundPaid({
    id, adminId: guard.user.id,
    receiptUrl: input.receiptUrl ?? null, transferReference: input.transferReference ?? null,
    account: input.account ?? null,
  });
  if (!r.ok) {
    if (r.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Refund not found');
    if (r.reason === 'INVALID_ACCOUNT_NUMBER') return jsonError(422, r.reason, 'The account number must be 20 digits');
    if (r.reason === 'INVALID_HOLDER_NAME') return jsonError(422, r.reason, 'The account holder name is required');
    return jsonError(409, 'WRONG_STATE', 'The client has not given an account yet');
  }
  if (!r.replayed) audit('REFUND_PAID', { amount: r.request.amount, reference: r.request.transferReference ?? null });
  return json({ refund: r.request, replayed: r.replayed });
}
