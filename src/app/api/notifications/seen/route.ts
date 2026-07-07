/**
 * POST /api/notifications/seen  { key }
 *   → 200 { key, seenAt: ISOString }
 *
 * The notification engine's ONLY write: stamps the caller's own
 * `notificationsSeen[key]`. The key must belong to the caller's role
 * registry — nothing else is accepted, and only the caller's user record
 * is ever touched.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { markSeen } from '@/server/notifications/counts';
import { sourceKeysForRole } from '@/server/notifications/activity-sources';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let key: unknown;
  try {
    ({ key } = (await req.json()) as { key?: unknown });
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'Invalid JSON body');
  }

  if (typeof key !== 'string' || !sourceKeysForRole(guard.user.role).includes(key)) {
    return jsonError(400, 'INVALID_SOURCE_KEY', 'Unknown source key for this role');
  }

  const seenAt = await markSeen(guard.user.id, key);
  if (!seenAt) return jsonError(500, 'SEEN_WRITE_FAILED', 'Could not record seen state');

  return json({ key, seenAt });
}
