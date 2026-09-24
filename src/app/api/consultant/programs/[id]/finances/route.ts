/**
 * GET /api/consultant/programs/[id]/finances — the program's financial report
 *     and the expenses tagged with it
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleGetProgramFinances } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleGetProgramFinances(id, mentorScope(guard.mentorId));
}
