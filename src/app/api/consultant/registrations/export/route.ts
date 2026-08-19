/**
 * GET /api/consultant/registrations/export?entityId=
 * CSV of a consultant-owned program's registrants. Same canonical builder the
 * incubator export uses (UTF-8 BOM + custom-field columns), mentor-scoped.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { buildRegistrationsCsv, mentorScope } from '@/server/registrations/service';
import { jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return jsonError(400, 'MISSING_PARAM', 'entityId is required');

  const data = await db.read();
  const program = (data.programs ?? []).find(
    (p) => p.id === entityId && p.mentorId === guard.mentorId,
  );
  if (!program) return jsonError(403, 'FORBIDDEN', 'This program does not belong to you');

  const csv = await buildRegistrationsCsv('PROGRAM', entityId, mentorScope(guard.mentorId));
  const filename = `${program.slug ?? program.id}-registrations.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
