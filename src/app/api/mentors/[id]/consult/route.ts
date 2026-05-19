/**
 * POST /api/mentors/:id/consult — DEPRECATED.
 *
 * This route used to auto-confirm consultations, debit the wallet directly,
 * and write to `mentorConsultations` without admin review. It was removed
 * because it allowed any authenticated client to bypass the admin approval
 * step now enforced by POST /api/mentors/:id/book.
 *
 * The file is kept (rather than deleted) so legacy clients still hitting
 * this URL receive a clean 410 GONE response instead of a generic 404.
 */
import { jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return jsonError(
    410,
    'ENDPOINT_DEPRECATED',
    'Use POST /api/mentors/[id]/book instead. This route was deprecated to enforce admin review.',
  );
}

export async function GET() {
  return jsonError(
    410,
    'ENDPOINT_DEPRECATED',
    'Use POST /api/mentors/[id]/book instead. This route was deprecated to enforce admin review.',
  );
}
