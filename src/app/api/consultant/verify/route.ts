/**
 * GET /api/consultant/verify?token=...&locale=...
 *
 * Consumes a consultant magic-link token, mints a portal session (cookie), and
 * redirects to the consultant portal. Flag-gated. On an invalid/expired/used
 * token, redirects to the portal sign-in with an error code (no session set).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { jsonError } from '@/server/http/json';
import {
  consumeMentorMagicLink,
  createMentorSession,
  setMentorSessionCookie,
} from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');

  const token = req.nextUrl.searchParams.get('token');
  const locale = req.nextUrl.searchParams.get('locale') ?? 'fr';
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const portal = `${base}/${locale}/consultant`;

  if (!token) return NextResponse.redirect(`${portal}?error=invalid`);

  const result = await consumeMentorMagicLink(token);
  if (!result.ok) {
    return NextResponse.redirect(`${portal}?error=${result.reason.toLowerCase()}`);
  }

  const session = await createMentorSession(result.mentorId);
  await setMentorSessionCookie(session);
  return NextResponse.redirect(portal);
}
