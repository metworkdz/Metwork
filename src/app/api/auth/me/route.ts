/**
 * GET /api/auth/me
 *
 * Returns the current user (SessionUser shape) or 401 when not authed.
 * Called by both AuthProvider on the client and getServerSession on the
 * server (which forwards the cookie via the Cookie header).
 */
import { readSession } from '@/server/auth/session';
import { toSessionUser } from '@/server/auth/serialize';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await readSession();
  if (!ctx) return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated');
  return json(toSessionUser(ctx.user));
}
