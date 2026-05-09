/**
 * GET /api/notifications
 * Returns the current user's notifications, newest first.
 * Query params:
 *   ?limit=20  (default 20, max 50)
 *   ?unread=1  (only unread)
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const limitParam = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 50);
  const unreadOnly = url.searchParams.get('unread') === '1';

  const data = await db.read();
  const all = (data.notifications ?? [])
    .filter((n) => n.userId === guard.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filtered = unreadOnly ? all.filter((n) => !n.read) : all;
  const items = filtered.slice(0, limit);
  const unreadCount = all.filter((n) => !n.read).length;

  return json({ notifications: items, unreadCount, total: filtered.length });
}
