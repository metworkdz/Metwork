/**
 * GET /api/auth/me
 *
 * Returns the current user (SessionUser shape) or 401 when not authed.
 * Called by both AuthProvider on the client and getServerSession on the
 * server (which forwards the cookie via the Cookie header).
 */
import { readSession } from '@/server/auth/session';
import { toSessionUser } from '@/server/auth/serialize';
import { db } from '@/server/db/store';
import { isArchivedIncubatorManager } from '@/server/incubator/visibility';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await readSession();
  if (!ctx) return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated');

  // Soft-archived incubator owners are treated as logged-out everywhere so any
  // existing session is effectively invalidated (RSC guards redirect to login).
  if (ctx.user.role === 'INCUBATOR') {
    const data = await db.read();
    if (isArchivedIncubatorManager(data.incubators ?? [], ctx.user.id)) {
      return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated');
    }
  }

  return json(toSessionUser(ctx.user));
}
