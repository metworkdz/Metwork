/**
 * Vercel Cron — monthly membership auto-renewal.
 *
 * Schedule: `30 2 * * *` (02:30 UTC daily, after process-downgrades at 01:00
 * so a cancelled plan is already handled). All logic lives in
 * `@/server/memberships/renewals`; this route only authenticates the caller.
 *
 * Secured by `CRON_SECRET` — same pattern as `/api/cron/incubator-billing`.
 */
import { NextResponse } from 'next/server';
import { runMembershipRenewals } from '@/server/memberships/renewals';

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
  const result = await runMembershipRenewals();
  const summary = {
    renewed: result.renewed.length,
    lapsed: result.lapsed.length,
    reminded: result.reminded.length,
    errors: result.errors,
    durationMs: Date.now() - startedAt,
  };
  console.info('[cron] membership-renewals: finished', summary);
  return NextResponse.json({ ok: true, ...summary });
}

// Vercel Cron issues GET; POST kept for manual runs, like the other crons.
export const GET = handle;
export const POST = handle;
