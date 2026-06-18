/**
 * POST /api/mentors/:id/guest-book — RETIRED (P7b).
 *
 * The legacy guest "request → admin approval → pay link" flow was replaced by
 * the instant-book, pay-first flow. Guests now book through
 * POST /api/mentors/[id]/instant-book and pay via /consultation/pay/[token].
 * Kept as a 410 GONE tombstone so legacy clients get a clean signal.
 */
import { jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  return jsonError(
    410,
    'ENDPOINT_RETIRED',
    'Use POST /api/mentors/[id]/instant-book instead. The guest request-then-approve flow was retired.',
  );
}
