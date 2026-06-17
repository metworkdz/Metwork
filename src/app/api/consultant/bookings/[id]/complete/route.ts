/**
 * POST /api/consultant/bookings/:id/complete
 *
 * The consultant marks a session COMPLETED, releasing their held (PENDING)
 * earning to AVAILABLE. Ownership-enforced and idempotent.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { completeConsultation } from '@/server/consultations/lifecycle';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find((b) => b.id === id);
  if (!booking || booking.mentorId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }

  const result = await completeConsultation(id);
  if (!result.ok) {
    if (result.reason === 'WRONG_STATE') return jsonError(409, 'WRONG_STATE', 'This booking cannot be completed in its current state');
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }
  return json({ id: result.booking.id, status: result.booking.status, completedAt: result.booking.completedAt, released: result.released });
}
