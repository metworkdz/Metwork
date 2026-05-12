/**
 * POST /api/cron/expire-promo-codes
 *
 * Daily cron (midnight UTC) — sweeps partner promo codes that have passed
 * their `validUntil` date and returns a count for ops visibility.
 *
 * GET  → health check / last-run info (returns current expired code count).
 *
 * Secured by CRON_SECRET (same pattern as reset-credits cron).
 */
import type { NextRequest } from 'next/server';
import { expireOldCodes } from '@/server/network/partner-promo-service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Allow when secret is not configured (dev / staging without the env var)
    return process.env.NODE_ENV !== 'production';
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return jsonError(401, 'UNAUTHORIZED', 'Missing or invalid CRON_SECRET');
  }

  const start = Date.now();
  const result = await expireOldCodes();

  return json({
    ok: true,
    expired: result.expired,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  });
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return jsonError(401, 'UNAUTHORIZED', 'Missing or invalid CRON_SECRET');
  }

  const result = await expireOldCodes();
  return json({ ok: true, currentlyExpiredCount: result.expired });
}
