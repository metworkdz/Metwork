/**
 * Vercel Cron — Startup Academy Pass, daily at 02:45:
 *   1. renewals (reminder 3 days before; monthly renewal from the wallet; ended terms expire),
 *   1b. incubator seats: each seat's holder gets the month that has just begun,
 *   2. settlement (every subscriber month that ended is split between the
 *      mentors watched and credited to their wallets).
 * Works on GET (what Vercel Cron sends) and POST. Both steps are idempotent.
 * Secured by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { runPassRenewals, settlePassMonths } from '@/server/academy/pass';
import { grantDueSeatMonths } from '@/server/academy/seats';

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
  if (!isCronAuthorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const renewals = await runPassRenewals();
  const seats = await grantDueSeatMonths();
  const settlement = await settlePassMonths();
  console.info('[cron] academy-pass', { renewals, seats, settlement });
  return NextResponse.json({ ok: true, renewals, seats, settlement });
}

export const GET = handle;
export const POST = handle;
