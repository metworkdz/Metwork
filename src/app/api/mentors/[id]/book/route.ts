/**
 * POST /api/mentors/:id/book — RETIRED (P7b).
 *
 * The legacy "request → admin approval" consultation flow was replaced by the
 * instant-book, pay-first flow. Bookings now go through
 * POST /api/mentors/[id]/instant-book (members + guests). This route is kept as
 * a 410 GONE tombstone so any legacy client gets a clean signal instead of a 404.
 */
import { jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  return jsonError(
    410,
    'ENDPOINT_RETIRED',
    'Use POST /api/mentors/[id]/instant-book instead. The request-then-approve flow was retired.',
  );
}
