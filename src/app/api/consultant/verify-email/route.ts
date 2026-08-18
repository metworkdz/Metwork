/**
 * GET /api/consultant/verify-email?token=… — consume a consultant's email
 * verification link.
 *
 * PUBLIC by design: the token IS the credential, exactly like the user-facing
 * /api/auth/verify-email. It carries no session, so a consultant can click the
 * link from any device or mail client.
 *
 * Always redirects back into the portal with a status flag rather than
 * rendering JSON — the link is opened by a human, not a client.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { consumeMentorEmailToken } from '@/server/mentors/email-verification';
import { clientEnvVars } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim();
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const back = (status: string) => NextResponse.redirect(`${base}/mentordashboard?email=${status}`);

  if (!token) return back('invalid');

  const result = await consumeMentorEmailToken(token);
  if (!result.ok) {
    // A consumed token means the address is already verified — that is a
    // success from the consultant's point of view, not an error.
    return back(result.reason === 'CONSUMED' ? 'verified' : result.reason.toLowerCase());
  }
  return back('verified');
}
