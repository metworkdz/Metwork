/**
 * GET /api/consultations
 * List the current user's mentor consultations, newest first.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const userId = guard.user.id;
  const data = await db.read();

  const all = (data.mentorConsultations ?? [])
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({
    items: all,
    total: all.length,
  });
}
