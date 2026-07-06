/**
 * GET  /api/nav-badges  → { badges: { [navKey]: count }, keys: string[] }
 *   Current counts for the session user's role + the role's registered keys
 *   (the client uses `keys` to know which routes participate in mark-seen).
 *
 * POST /api/nav-badges  { navKey }
 *   The feature's ONLY write: stamps the caller's own `navLastSeen[navKey]`.
 *   The key must belong to the caller's role registry — nothing else is
 *   accepted, and only the caller's user record is ever touched.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { getNavBadges, markNavSeen } from '@/server/notifications/nav-badges';
import { navKeysForRole } from '@/server/notifications/activity-sources';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const badges = await getNavBadges(guard.user.id);
  return json({ badges, keys: navKeysForRole(guard.user.role) });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let navKey: unknown;
  try {
    ({ navKey } = (await req.json()) as { navKey?: unknown });
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'Invalid JSON body');
  }

  if (typeof navKey !== 'string' || !navKeysForRole(guard.user.role).includes(navKey)) {
    return jsonError(400, 'INVALID_NAV_KEY', 'Unknown nav key for this role');
  }

  await markNavSeen(guard.user.id, navKey);
  return json({ ok: true });
}
