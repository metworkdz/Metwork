/** POST /api/metworkcrm/notifications/read-all — mark all of the caller's unread notifications read. */
import { json } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { markAllNotificationsRead } from '@/server/metworkcrm/services/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  await markAllNotificationsRead(guard.user.id);
  return json({ ok: true });
}
