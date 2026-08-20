/**
 * POST /metworkcrm/logout
 *
 * Form-target for the sidebar's sign-out button, so logging out works with no
 * JavaScript. Mirrors /api/metworkcrm/auth/logout, but redirects instead of
 * returning JSON.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  clearCrmSessionCookie,
  deleteCurrentCrmSession,
} from '@/server/metworkcrm/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await deleteCurrentCrmSession();
  await clearCrmSessionCookie();
  // 303 so the browser follows with GET rather than re-POSTing.
  return NextResponse.redirect(new URL('/metworkcrm/login', req.url), 303);
}
