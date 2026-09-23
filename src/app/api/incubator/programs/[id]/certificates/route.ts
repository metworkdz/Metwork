/**
 * GET /api/incubator/programs/[id]/certificates — the program's certificate
 *     settings (saved, inherited from the last program, or the Metwork model)
 * PUT /api/incubator/programs/[id]/certificates — save them, body { settings }
 */
import type { NextRequest } from 'next/server';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { jsonError } from '@/server/http/json';
import { incubatorScope } from '@/server/registrations/service';
import {
  handleGetCertificateSettings,
  handlePutCertificateSettings,
} from '@/server/certificates/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handleGetCertificateSettings(id, incubatorScope(inc.id));
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;
  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
  const { id } = await params;
  return handlePutCertificateSettings(req, id, incubatorScope(inc.id));
}
