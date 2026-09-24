/**
 * PATCH  /api/consultant/programs/[id]/finances/expenses/[expenseId]
 * DELETE /api/consultant/programs/[id]/finances/expenses/[expenseId]
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleDeleteProgramExpense, handleUpdateProgramExpense } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id, expenseId } = await params;
  return handleUpdateProgramExpense(req, id, expenseId, mentorScope(guard.mentorId));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id, expenseId } = await params;
  return handleDeleteProgramExpense(id, expenseId, mentorScope(guard.mentorId));
}
