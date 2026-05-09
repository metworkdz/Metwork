/**
 * Server-side helper — create an in-app notification for a user.
 * Fire-and-forget: errors are caught and logged so they never crash the caller.
 */
import { randomUUID } from 'node:crypto';
import { db, type NotificationType } from '@/server/db/store';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await db.update((d) => {
      if (!Array.isArray(d.notifications)) d.notifications = [];
      d.notifications.push({
        id: randomUUID(),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        read: false,
        createdAt: new Date().toISOString(),
      });
      // Keep at most 100 notifications per user to cap storage (prune oldest first)
      const userNotifs = d.notifications.filter((n) => n.userId === input.userId);
      if (userNotifs.length > 100) {
        const otherNotifs = d.notifications.filter((n) => n.userId !== input.userId);
        const pruned = userNotifs.slice(userNotifs.length - 100); // keep newest 100
        d.notifications = [...otherNotifs, ...pruned];
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] createNotification failed:', err);
  }
}
