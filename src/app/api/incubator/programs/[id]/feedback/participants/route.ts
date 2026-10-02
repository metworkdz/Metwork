/**
 * GET /api/incubator/programs/[id]/feedback/participants — confirmed participants, sent / answered
 *
 * Incubator dashboard — the handlers are shared, in @/server/feedback/routes.
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope, type OwnerScope } from '@/server/registrations/service';
import { handleFeedbackParticipants } from '@/server/feedback/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function owner(): Promise<OwnerScope | Response> {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  return incubatorScope(inc.id);
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const o = await owner();
  if (o instanceof Response) return o;
  const { id } = await params;
  return handleFeedbackParticipants(id, o);
}
