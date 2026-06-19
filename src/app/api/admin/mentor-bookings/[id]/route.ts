/**
 * PATCH /api/admin/mentor-bookings/:id — RETIRED (410 GONE).
 *
 * The legacy admin approve/decline gate was retired: instant-book is now the
 * only consultation flow (paid up front, auto-confirmed, no admin review). This
 * endpoint is kept as a tombstone so any legacy client receives a clean signal
 * instead of a 404. Admin oversight is read-only (GET /api/admin/mentor-bookings);
 * acting on a booking on the consultant's behalf lives in the dedicated
 * /api/admin/consultations/:id/{link,complete} endpoints.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH() {
  // Keep the admin guard so an unauthenticated probe still gets 401, not 410.
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  return jsonError(
    410,
    'APPROVAL_RETIRED',
    'Consultation approval was retired. Bookings are now instant-confirmed; use the consultant link/complete endpoints for oversight actions.',
  );
}
