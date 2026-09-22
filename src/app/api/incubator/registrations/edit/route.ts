/**
 * POST /api/incubator/registrations/edit — body { id, fullName?, email?, phone? }
 *
 * A sub-route rather than a verb on the collection: the consultant surface
 * already spends PATCH on "cancel", and the participants table is shared, so
 * the two surfaces have to answer the same shape.
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import { handleEditRegistration } from '@/server/registrations/edit-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  return handleEditRegistration(req, incubatorScope(inc.id));
}
