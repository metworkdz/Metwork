/**
 * POST /api/academy/mock-upload — where the MOCK video host "receives" files in
 * local development. Discards the file. 404 in production; admins and mentors only.
 */
import { jsonError, json } from '@/server/http/json';
import { requireAcademyAdmin } from '@/server/academy/http';
import { readMentorSession } from '@/server/mentors/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (process.env.NODE_ENV === 'production') return jsonError(404, 'NOT_FOUND', 'Not found');
  // Admins (course builder) and mentors (Studio) upload here in local development.
  if (!(await readMentorSession())) {
    const g = await requireAcademyAdmin();
    if (!g.ok) return g.response;
  }
  return json({ ok: true }, { status: 201 });
}
