/**
 * POST /api/metworkcrm/auth/logout
 * Deletes the server-side session row and clears the cookie.
 */
import { json } from '@/server/http/json';
import {
  clearCrmSessionCookie,
  deleteCurrentCrmSession,
} from '@/server/metworkcrm/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await deleteCurrentCrmSession();
  await clearCrmSessionCookie();
  return json({ ok: true });
}
