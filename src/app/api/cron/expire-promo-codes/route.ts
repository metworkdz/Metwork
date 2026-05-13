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
  // Allow unauthenticated access only in test environments.
  if (!secret) {
    return process.env.NODE_ENV === 'test';
  }
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return jsonError(501, 'NOT_CONFIGURED', 'CRON_SECRET not configured');
  }
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
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return jsonError(501, 'NOT_CONFIGURED', 'CRON_SECRET not configured');
  }
  if (!verifyCronSecret(req)) {
    return jsonError(401, 'UNAUTHORIZED', 'Missing or invalid CRON_SECRET');
  }

  const result = await expireOldCodes();
  return json({ ok: true, currentlyExpiredCount: result.expired });
}
