/**
 * Vercel Cron — Daily Network Pass Credit Expiry Reminder
 *
 * Schedule: `0 9 * * *` (09:00 UTC daily — only sends on the last day of month)
 * Secured by the same `CRON_SECRET` used by the monthly reset route.
 */

import { NextResponse } from 'next/server';
import { sendExpiryReminders } from '@/server/network/credit-service';

export const runtime = 'nodejs';

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Allow unauthenticated access only in test environments.
  if (!cronSecret) {
    return process.env.NODE_ENV === 'test';
  }
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendExpiryReminders();

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    errors: result.errors,
  });
}
