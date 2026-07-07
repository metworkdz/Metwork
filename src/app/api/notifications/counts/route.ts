/**
 * GET /api/notifications/counts
 *   → 200 { counts: { [sourceKey]: number }, generatedAt: ISOString }
 *
 * Role-scoped activity counts for the session user. The role is derived from
 * the session — a client-supplied role is never trusted. Every source of the
 * role is present in `counts` (0 included); a failing source contributes 0
 * (logged server-side) and never fails the response.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { getNotificationCounts } from '@/server/notifications/counts';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const counts = await getNotificationCounts(guard.user.id);
  return json({ counts, generatedAt: new Date().toISOString() });
}
