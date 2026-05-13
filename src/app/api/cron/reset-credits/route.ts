/**
 * Vercel Cron — Monthly Network Pass Credit Reset
 *
 * Schedule: `0 0 1 * *`  (00:00 UTC on the 1st of every month)
 * Secured by `CRON_SECRET` env var — Vercel passes this automatically in
 * the `Authorization: Bearer <secret>` header when invoking cron routes.
 *
 * Can also be triggered manually by an admin via:
 *   POST /api/cron/reset-credits   with Authorization: Bearer <CRON_SECRET>
 *
 * Daily expiry reminders share the same secret but use a separate path:
 *   POST /api/cron/credit-expiry-reminders
 */

import { NextResponse } from 'next/server';
import {
  resetMonthlyCredits,
  sendExpiryReminders,
} from '@/server/network/credit-service';

// Vercel wraps cron invocations as POST requests
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Allow unauthenticated access only in test environments.
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'test') return true;
    // All other environments (development, staging, production) require the
    // secret to be configured — returning false causes a 401 response.
    return false;
  }
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

function missingCronSecret(): Response {
  return NextResponse.json(
    { error: 'CRON_SECRET not configured' },
    { status: 501 },
  );
}

// ---------------------------------------------------------------------------
// POST /api/cron/reset-credits — Monthly credit reset
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return missingCronSecret();
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  console.info('[cron] reset-credits: starting monthly credit reset');

  const result = await resetMonthlyCredits();

  const duration = Date.now() - startedAt;
  console.info('[cron] reset-credits: finished', {
    usersReset: result.usersReset,
    errorCount: result.errors.length,
    durationMs: duration,
  });

  if (result.errors.length > 0) {
    console.warn('[cron] reset-credits: partial failures', result.errors);
  }

  return NextResponse.json({
    ok: true,
    usersReset: result.usersReset,
    timestamp: result.timestamp,
    durationMs: duration,
    errors: result.errors,
  });
}

// ---------------------------------------------------------------------------
// GET /api/cron/reset-credits — Health check (returns current credit config)
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return missingCronSecret();
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { getAdminCreditConfig } = await import('@/server/network/credit-service');
  const config = await getAdminCreditConfig();

  return NextResponse.json({ ok: true, config });
}
