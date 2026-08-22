/**
 * POST /api/admin/contracts/:id/void  { confirm: true }
 *
 * Voiding is irreversible, so `confirm` is required IN THE REQUEST BODY and
 * checked server-side by `voidContract`. A dialog in the UI is not the gate —
 * a direct API call without the flag is refused too. Only a contract awaiting
 * signature can be voided; a signed one is evidence of an agreement that
 * actually happened.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { voidContract } from '@/server/consultant-contracts/service';
import { toAdminContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ confirm: z.literal(true) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  try { schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return jsonError(400, 'CONFIRMATION_REQUIRED', 'Voiding a contract requires an explicit confirmation.');
    }
    throw err;
  }

  const result = await voidContract(id, guard.user.id, { confirm: true });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Contract not found');
    if (result.reason === 'NOT_CONFIRMED') {
      return jsonError(400, 'CONFIRMATION_REQUIRED', 'Voiding a contract requires an explicit confirmation.');
    }
    return jsonError(409, 'NOT_PENDING', 'Only a contract awaiting signature can be voided.');
  }

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_VOIDED',
    targetType: 'consultant_contract',
    targetId: id,
    details: { consultantId: result.contract.consultantId },
  });

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === result.contract.consultantId) ?? null;
  return json({ contract: toAdminContractDto(result.contract, mentor) });
}
