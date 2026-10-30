/**
 * In-app (and push) notification to every admin account. Fire-and-forget by
 * contract: never throws, so a notification problem cannot affect the money
 * movement that triggered it.
 */
import { db, type NotificationType } from '@/server/db/store';
import { createNotification } from '@/server/notifications/create-notification';

export async function notifyAdmins(input: {
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
}): Promise<void> {
  try {
    const data = await db.read();
    const admins = data.users.filter((u) => u.role === 'ADMIN' && u.status !== 'SUSPENDED');
    for (const admin of admins) {
      await createNotification({ userId: admin.id, type: input.type, title: input.title, body: input.body, href: input.href });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] notifyAdmins failed:', err instanceof Error ? err.message : err);
  }
}
