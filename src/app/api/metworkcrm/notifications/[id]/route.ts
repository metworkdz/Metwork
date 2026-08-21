/**
 * PATCH /api/metworkcrm/notifications/:id — mark one notification read.
 * Scoped to the caller's own notifications (the service's WHERE clause
 * includes `userId`) — marking someone else's as read is a silent no-op,
 * not a 403/404, since the row simply doesn't match and nothing updates.
 */
import { json } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { markNotificationRead } from '@/server/metworkcrm/services/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(_req: Request, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  await markNotificationRead(id, guard.user.id);
  return json({ ok: true });
}
