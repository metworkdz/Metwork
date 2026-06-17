/**
 * POST /api/consultant/logout — clear the consultant portal session.
 */
import { json } from '@/server/http/json';
import { clearMentorSessionCookie, deleteCurrentMentorSession } from '@/server/mentors/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await deleteCurrentMentorSession();
  await clearMentorSessionCookie();
  return json({ ok: true });
}
