/**
 * GET /api/certificates/linkedin/start?t=<share token>
 *
 * PUBLIC: the « Publier sur LinkedIn » button on the share page. Checks the
 * certificate can be shared, binds this browser to the request (the state
 * cookie — see `@/server/certificates/linkedin/config`) and sends the
 * participant to LinkedIn's consent screen.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { authorizeUrl } from '@/server/certificates/linkedin/api';
import {
  appBaseUrl,
  LINKEDIN_STATE_COOKIE,
  LINKEDIN_STATE_TTL_S,
  linkedInConfig,
  linkedInRedirectUri,
  newOAuthState,
  sealOAuthState,
} from '@/server/certificates/linkedin/config';
import { resolveShareTarget } from '@/server/certificates/linkedin/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
}

export async function GET(req: NextRequest) {
  const shareToken = req.nextUrl.searchParams.get('t') ?? '';
  const config = linkedInConfig();
  const target = await resolveShareTarget(shareToken);
  if (!config || !target.ok) {
    return NextResponse.redirect(`${appBaseUrl()}/fr/attestation/linkedin/${encodeURIComponent(shareToken)}`, 303);
  }
  const page = `${appBaseUrl()}/${target.lang}/attestation/linkedin/${encodeURIComponent(shareToken)}`;
  // Already on LinkedIn: no second post, no second consent screen.
  if (target.postUrl) return NextResponse.redirect(page, 303);

  if (!(await checkRateLimitDistributed(`linkedin-start:ip:${clientIp(req)}`, 20, 10 * 60_000))) {
    return NextResponse.redirect(`${page}?error=RATE_LIMITED`, 303);
  }

  const state = newOAuthState(shareToken, target.lang);
  const res = NextResponse.redirect(authorizeUrl(config, linkedInRedirectUri(), state.nonce), 303);
  res.cookies.set(LINKEDIN_STATE_COOKIE, sealOAuthState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // LinkedIn returns with a top-level GET navigation: Lax still sends it.
    sameSite: 'lax',
    path: '/api/certificates/linkedin',
    maxAge: LINKEDIN_STATE_TTL_S,
  });
  return res;
}
