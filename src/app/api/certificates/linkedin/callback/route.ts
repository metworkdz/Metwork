/**
 * GET /api/certificates/linkedin/callback?code=…&state=… (or ?error=…)
 *
 * Where LinkedIn sends the participant back. The state must match the cookie
 * set by ../start in this same browser; then the certificate is published as
 * them (one post per certificate) and they land on the share page, which
 * shows the result.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  appBaseUrl,
  LINKEDIN_STATE_COOKIE,
  openOAuthState,
} from '@/server/certificates/linkedin/config';
import { publishCertificateOnLinkedIn } from '@/server/certificates/linkedin/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Render + upload + post: a few seconds, well inside the limit.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const state = openOAuthState(req.cookies.get(LINKEDIN_STATE_COOKIE)?.value, params.get('state'));

  const done = (url: string) => {
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(LINKEDIN_STATE_COOKIE, '', { path: '/api/certificates/linkedin', maxAge: 0 });
    return res;
  };

  // No (or a foreign) state: nothing tells us which certificate this was for.
  if (!state) return done(`${appBaseUrl()}/fr?linkedin=expired`);
  const page = `${appBaseUrl()}/${state.lang}/attestation/linkedin/${encodeURIComponent(state.shareToken)}`;

  // The participant pressed « Cancel » on LinkedIn's screen.
  const code = params.get('code');
  if (params.get('error') || !code) return done(`${page}?error=CANCELLED`);

  const result = await publishCertificateOnLinkedIn(state.shareToken, code);
  if (!result.ok) return done(`${page}?error=${result.reason}`);
  return done(`${page}?published=1`);
}
