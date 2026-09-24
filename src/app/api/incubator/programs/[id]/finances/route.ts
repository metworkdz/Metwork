/**
 * GET /api/incubator/programs/[id]/finances — the program's financial report
 *     and the expenses tagged with it
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import { handleGetProgramFinances } from '@/server/program-finance/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handleGetProgramFinances(id, incubatorScope(inc.id));
}
