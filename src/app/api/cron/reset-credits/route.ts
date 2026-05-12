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
  if (!cronSecret) {
    // If CRON_SECRET is unset in development, allow the request.
    // Block in production — the check below ensures CRON_SECRET must be
    // present in any environment where NODE_ENV === 'production'.
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron] CRON_SECRET is not set in production — all cron requests rejected');
      return false;
    }
    return true;
  }
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// POST /api/cron/reset-credits — Monthly credit reset
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
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
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { getAdminCreditConfig } = await import('@/server/network/credit-service');
  const config = await getAdminCreditConfig();

  return NextResponse.json({ ok: true, config });
}
