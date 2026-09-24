/**
 * POST /api/consultant/programs/[id]/finances/expenses — add an expense to the program
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleCreateProgramExpense } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleCreateProgramExpense(req, id, mentorScope(guard.mentorId));
}
