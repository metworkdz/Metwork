/**
 * PATCH /api/admin/contracts/:id — revise a contract's terms.
 *
 * Legal ONLY while DRAFT, and that is enforced in the service, not by hiding
 * the button: once a contract has been put in front of a consultant, the text
 * they were asked to sign must not change underneath them. The path forward for
 * revised terms is void + create a new contract.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { editDraftContract, findContractById } from '@/server/consultant-contracts/service';
import { toAdminContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  contentSnapshot: z.string().min(1).max(100_000).optional(),
  payoutMethod: z.enum(['BANK_TRANSFER', 'CCP', 'CHEQUE']).optional(),
  payoutDetails: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await editDraftContract(id, input);
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Contract not found');
    return jsonError(
      409,
      'NOT_DRAFT',
      'This contract has already been sent and can no longer be edited. Void it and create a new one.',
    );
  }

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_UPDATED',
    targetType: 'consultant_contract',
    targetId: id,
    details: { templateVersion: result.contract.templateVersion },
  });

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === result.contract.consultantId) ?? null;
  return json({ contract: toAdminContractDto(result.contract, mentor) });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const contract = await findContractById(id);
  if (!contract) return jsonError(404, 'NOT_FOUND', 'Contract not found');

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === contract.consultantId) ?? null;
  return json({ contract: toAdminContractDto(contract, mentor) });
}
