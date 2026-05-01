/**
 * GET /api/admin/mentor-bookings
 * List all mentor consultation requests. Admin only.
 * Optional ?status=PENDING|APPROVED|REJECTED filter.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const statusFilter = req.nextUrl.searchParams.get('status');
  const data = await db.read();
  const bookings = (data.mentorBookings ?? [])
    .filter((b) => !statusFilter || b.status === statusFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Enrich with mentor name for display
  const enriched = bookings.map((b) => {
    const mentor = data.mentors.find((m) => m.id === b.mentorId);
    return { ...b, mentorName: mentor?.fullName ?? 'Unknown mentor' };
  });

  return json({ items: enriched, total: enriched.length });
}
