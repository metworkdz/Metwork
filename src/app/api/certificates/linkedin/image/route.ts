/**
 * GET /api/certificates/linkedin/image?t=<share token>
 *
 * The certificate image the share page previews — the exact picture LinkedIn
 * will receive (QR code, no signature images, no stamp). Only through the
 * participant's own share link.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { shareImage } from '@/server/certificates/linkedin/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const shareToken = req.nextUrl.searchParams.get('t') ?? '';
  // Each render costs a couple of seconds of CPU — enough for reloads, not a loop.
  if (!(await checkRateLimitDistributed(`linkedin-image:${shareToken.slice(0, 80)}`, 30, 10 * 60_000))) {
    return new NextResponse('Too many requests', { status: 429 });
  }
  const png = await shareImage(shareToken);
  if (!png) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=600',
      'X-Robots-Tag': 'noindex',
    },
  });
}
