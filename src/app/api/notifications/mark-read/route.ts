/**
 * POST /api/notifications/mark-read
 * Mark notifications as read.
 * Body: { ids?: string[] }  — if omitted, marks ALL unread as read.
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: { ids?: string[] } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as { ids?: string[] };
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON or empty');
  }

  const { ids } = body;

  await db.update((d) => {
    if (!Array.isArray(d.notifications)) return;
    for (const n of d.notifications) {
      if (n.userId !== guard.user.id) continue;
      if (!ids || ids.includes(n.id)) n.read = true;
    }
  });

  return json({ ok: true });
}
