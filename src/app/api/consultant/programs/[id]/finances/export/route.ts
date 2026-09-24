/**
 * GET /api/consultant/programs/[id]/finances/export?format=csv|pdf&lang=fr|en|ar
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { mentorScope } from '@/server/registrations/service';
import { handleExportProgramFinances } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return handleExportProgramFinances(req, id, mentorScope(guard.mentorId));
}
