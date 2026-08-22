/**
 * GET /api/metworkcrm/notifications — the lazy sweep (product spec §4.16,
 * Prompt 7): runs `syncNotifications()` inline, then returns the caller's
 * own notifications. Polled by the notification-bell component. The sweep is
 * global (not scoped to the caller) and every check inside it is already
 * wrapped so a failing check can't take down the others or this request.
 */
import { json } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { listNotifications, syncNotifications } from '@/server/metworkcrm/services/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  await syncNotifications();
  const { rows, unreadCount } = await listNotifications(guard.user.id);
  return json({ rows, unreadCount });
}
