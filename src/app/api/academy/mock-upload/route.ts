/**
 * POST /api/academy/mock-upload — where the MOCK video host "receives" files in
 * local development. Discards the file. 404 in production, and admin-only.
 */
import { jsonError, json } from '@/server/http/json';
import { requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (process.env.NODE_ENV === 'production') return jsonError(404, 'NOT_FOUND', 'Not found');
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  return json({ ok: true }, { status: 201 });
}
