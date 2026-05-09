/**
 * GET /api/incubator/bookings
 *
 * Returns all bookings for spaces and programs owned by the calling incubator,
 * enriched with the customer's name and email (joined from users table).
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');

  // Collect IDs of all spaces and programs belonging to this incubator
  const ownedSpaceIds = new Set(
    data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  const bookings = data.bookings
    .filter(
      (b) =>
        (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => {
      const user = b.userId ? data.users.find((u) => u.id === b.userId) : null;
      return {
        ...b,
        customerName: user?.fullName ?? b.clientName ?? 'Unknown',
        customerEmail: user?.email ?? b.clientEmail ?? '',
        customerPhone: user?.phone ?? b.clientPhone ?? '',
      };
    });

  return json({ bookings, total: bookings.length });
}
