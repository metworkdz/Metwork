/**
 * GET /api/cron/space-expiry
 *
 * Daily cron entrypoint that emails incubators a reminder when a COWORKING desk
 * or PRIVATE_OFFICE rental is ending in 1–2 days. Protected by a shared secret:
 *
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Recommended vercel.json cron config (runs every day at 08:00 UTC):
 *   {
 *     "crons": [
 *       { "path": "/api/cron/space-expiry", "schedule": "0 8 * * *" }
 *     ]
 *   }
 *
 * Never throws — wraps the work in try/catch and returns { error } on failure so
 * a scheduler retry policy never sees a 500 from an internal hiccup.
 */
import type { NextRequest } from 'next/server';
import { checkAndSendExpiryReminders } from '@/server/spaces/expiry-notifier';
import { sweepExpiredRequestBookings } from '@/server/bookings/request-expiry';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  // Require a configured secret AND an exact Bearer match. An unset secret means
  // the endpoint is locked down (rejects everything) rather than open.
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { sent, checked } = await checkAndSendExpiryReminders();
    // REQUEST-mode reservations: expire stale AWAITING_APPROVAL requests and
    // lapsed APPROVED_UNPAID payment links (idempotent; no money moves).
    const { expired } = await sweepExpiredRequestBookings();
    return json({ sent, checked, expired });
  } catch (err) {
    console.error('[cron/space-expiry] failed', err);
    return json({ error: 'EXPIRY_CHECK_FAILED' }, { status: 500 });
  }
}
