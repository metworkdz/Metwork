/**
 * GET /api/verify/:code — PUBLIC voucher verification (no auth).
 *
 * Voucher validity is computed LIVE from the holder's current membership —
 * nothing is cached on the voucher. The response exposes first name +
 * last-initial only ("Ahmed B."), never full name / email / phone.
 * Unknown codes get a generic 404 that leaks nothing about valid patterns.
 *
 * TODO(follow-up): wire the @upstash/ratelimit sliding-window limiter in
 * front of this endpoint to slow down voucher-code enumeration.
 */
import type { NextRequest } from 'next/server';
import { verifyVoucher } from '@/server/perks/service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;

  const result = await verifyVoucher(decodeURIComponent(code));
  if (!result) return jsonError(404, 'NOT_FOUND', 'Not found');

  return json(result);
}
