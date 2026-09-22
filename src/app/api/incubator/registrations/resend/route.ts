/**
 * POST /api/incubator/registrations/resend — body { id }
 *
 * Send the confirmation and the stamped receipt again, to whatever address is
 * on file now. For when the first one bounced, went to a typo, or the client
 * deleted it. Rate-limited per registration.
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import { handleResendRegistration } from '@/server/registrations/edit-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  return handleResendRegistration(req, incubatorScope(inc.id));
}
