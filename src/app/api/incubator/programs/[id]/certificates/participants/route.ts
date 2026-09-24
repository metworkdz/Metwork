/**
 * GET   /api/incubator/programs/[id]/certificates/participants — confirmed participants, with
 *       attendance, civility, balance still due and certificate status
 * PATCH /api/incubator/programs/[id]/certificates/participants — body { registrationId, absent?, civility? }
 */
import type { NextRequest } from 'next/server';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import { handleListCertificateParticipants, handleUpdateCertificateParticipant } from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handleListCertificateParticipants(id, incubatorScope(inc.id));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handleUpdateCertificateParticipant(req, id, incubatorScope(inc.id));
}
