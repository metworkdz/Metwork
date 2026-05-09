/**
 * GET /api/incubator/members
 *
 * Returns all users who have an active (non-cancelled, non-refunded) booking
 * for any PROGRAM owned by the calling incubator. Deduped by userId.
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

  const ownedProgramIds = new Set(
    data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  // Enrollments: active program bookings
  const enrollments = data.bookings.filter(
    (b) =>
      b.itemKind === 'PROGRAM' &&
      ownedProgramIds.has(b.itemId) &&
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED',
  );

  // Deduplicate: keep the most recent booking per user per program
  const seen = new Set<string>();
  const members = enrollments
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .reduce<
      { userId: string; name: string; email: string; phone: string; programName: string; enrolledAt: string; bookingId: string }[]
    >((acc, b) => {
      const key = `${b.userId ?? '__offline__'}:${b.itemId}`;
      if (seen.has(key)) return acc;
      seen.add(key);
      const user = b.userId ? data.users.find((u) => u.id === b.userId) : null;
      acc.push({
        userId: b.userId ?? '',
        name: user?.fullName ?? b.clientName ?? 'Unknown',
        email: user?.email ?? '',
        phone: user?.phone ?? '',
        programName: b.itemName,
        enrolledAt: b.createdAt,
        bookingId: b.id,
      });
      return acc;
    }, []);

  return json({ members, total: members.length });
}
