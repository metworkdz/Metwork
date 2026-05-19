/**
 * GET /api/admin/spaces — list every SpaceRecord (admin only)
 *
 * Used by admin tooling (Partner Network enrolment dialog, etc.) that needs
 * to pick a space across all incubators. Returns a slim projection of the
 * fields admins actually need so the response stays small.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = (data.spaces ?? [])
    .map((s) => ({
      id:             s.id,
      name:           s.name,
      incubatorId:    s.incubatorId,
      incubatorName:  s.incubatorName,
      city:           s.city,
      isActive:       s.isActive,
      isEnrolled:     Boolean(s.partnerMembershipId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return json({ items, total: items.length });
}
