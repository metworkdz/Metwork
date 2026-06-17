/**
 * POST /api/admin/consultations/:id/complete
 *
 * Admin marks an instant-book consultation COMPLETED on the consultant's
 * behalf, releasing the held earning (PENDING → AVAILABLE). Admin-only,
 * idempotent.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { completeConsultation } from '@/server/consultations/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await completeConsultation(id);
  if (!result.ok) {
    if (result.reason === 'WRONG_STATE') return jsonError(409, 'WRONG_STATE', 'This booking cannot be completed in its current state');
    if (result.reason === 'NOT_INSTANT_BOOK') return jsonError(409, 'NOT_INSTANT_BOOK', 'Not an instant-book consultation');
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }
  return json({ id: result.booking.id, status: result.booking.status, completedAt: result.booking.completedAt, released: result.released });
}
