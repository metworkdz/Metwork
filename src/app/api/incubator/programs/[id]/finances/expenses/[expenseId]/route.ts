/**
 * PATCH  /api/incubator/programs/[id]/finances/expenses/[expenseId]
 * DELETE /api/incubator/programs/[id]/finances/expenses/[expenseId]
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import { handleDeleteProgramExpense, handleUpdateProgramExpense } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id, expenseId } = await params;
  return handleUpdateProgramExpense(req, id, expenseId, incubatorScope(inc.id));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id, expenseId } = await params;
  return handleDeleteProgramExpense(id, expenseId, incubatorScope(inc.id));
}
