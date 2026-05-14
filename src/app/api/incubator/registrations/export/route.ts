/**
 * GET /api/incubator/registrations/export?entityType=&entityId=
 *
 * Returns a UTF-8 BOM CSV file with all registrations.
 * Excel-compatible (CRLF line endings, double-quote escaping).
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { buildRegistrationsCsv } from '@/server/registrations/service';
import { jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') as 'PROGRAM' | 'EVENT' | null;
  const entityId   = searchParams.get('entityId');

  if (!entityType || !['PROGRAM', 'EVENT'].includes(entityType)) {
    return jsonError(400, 'MISSING_PARAM', 'entityType must be PROGRAM or EVENT');
  }
  if (!entityId) {
    return jsonError(400, 'MISSING_PARAM', 'entityId is required');
  }

  // Verify the entity belongs to this incubator
  const data = await db.read();
  const owned =
    entityType === 'PROGRAM'
      ? (data.programs ?? []).some((p) => p.id === entityId && p.incubatorId === inc.id)
      : (data.events ?? []).some((e) => e.id === entityId && e.incubatorId === inc.id);
  if (!owned) return jsonError(403, 'FORBIDDEN', 'This entity does not belong to your incubator');

  const csv = await buildRegistrationsCsv(entityType, entityId, inc.id);

  const entityTitle =
    entityType === 'PROGRAM'
      ? ((data.programs ?? []).find((p) => p.id === entityId)?.title ?? 'program')
      : ((data.events ?? []).find((e) => e.id === entityId)?.title ?? 'event');

  const filename = `registrations-${entityTitle.slice(0, 40).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
