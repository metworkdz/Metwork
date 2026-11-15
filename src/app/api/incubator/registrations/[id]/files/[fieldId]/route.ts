/**
 * GET /api/incubator/registrations/:id/files/:fieldId[?download=1]
 *
 * Open the file a participant attached to a registration. Owner-only: see
 * `@/server/registrations/file-route`.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { incubatorScope } from '@/server/registrations/service';
import { jsonError } from '@/server/http/json';
import { handleRegistrationFile } from '@/server/registrations/file-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id, fieldId } = await params;
  return handleRegistrationFile(req, incubatorScope(inc.id), id, fieldId);
}
