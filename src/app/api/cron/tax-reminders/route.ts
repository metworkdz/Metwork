/**
 * Vercel Cron — tax calendar reminders (first reminder, J-7, J-1).
 *
 * Schedule: `0 8 * * *` (08:00 UTC = 09:00 Algiers, daily). All logic lives in
 * `@/server/taxes/service`; this route only authenticates the caller.
 *
 * Secured by `CRON_SECRET` — same pattern as `/api/cron/incubator-billing`.
 */
import { NextResponse } from 'next/server';
import { runTaxReminders } from '@/server/taxes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV === 'test';
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const startedAt = Date.now();
  const result = await runTaxReminders();
  const summary = {
    sent: result.sent,
    users: result.users,
    durationMs: Date.now() - startedAt,
  };
  console.info('[cron] tax-reminders: finished', summary);
  return NextResponse.json({ ok: true, ...summary });
}

// Vercel Cron issues GET; POST kept for manual runs, like the other crons.
export const GET = handle;
export const POST = handle;
