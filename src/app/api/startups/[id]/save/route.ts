/**
 * POST /api/startups/:id/save   — toggle save/unsave a startup
 * GET  /api/startups/:id/save   — check if current user has saved it
 *
 * Returns { saved: boolean }
 */
import { randomUUID } from 'node:crypto';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: startupId } = await params;
  const data = await db.read();
  const saved = (data.savedStartups ?? []).some(
    (s) => s.userId === guard.user.id && s.startupId === startupId,
  );

  return json({ saved });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: startupId } = await params;
  const startup = await findStartupById(startupId);
  if (!startup || startup.status !== 'ACTIVE') {
    return jsonError(404, 'NOT_FOUND', 'Startup not found');
  }

  const saved = await db.update((d) => {
    if (!Array.isArray(d.savedStartups)) d.savedStartups = [];
    const idx = d.savedStartups.findIndex(
      (s) => s.userId === guard.user.id && s.startupId === startupId,
    );
    if (idx !== -1) {
      // Already saved → unsave
      d.savedStartups.splice(idx, 1);
      return false;
    }
    d.savedStartups.push({
      id: randomUUID(),
      userId: guard.user.id,
      startupId,
      createdAt: new Date().toISOString(),
    });
    return true;
  });

  return json({ saved });
}
