/**
 * POST /api/auth/logout
 *
 * Deletes the current session record server-side and clears the cookie.
 * Idempotent — returning 204 even if no session was present.
 */
import { deleteCurrentSession, clearSessionCookie } from '@/server/auth/session';
import { noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await deleteCurrentSession();
  await clearSessionCookie();
  return noContent();
}
