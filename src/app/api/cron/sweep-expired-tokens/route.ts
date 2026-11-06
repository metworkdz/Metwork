/**
 * Vercel Cron — daily: remove sessions, OTP codes, email tokens and remembered
 * devices that expired over a day ago. Idempotent (no write when nothing is
 * due). Secured by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { sweepExpiredTokens } from '@/server/auth/sweep-expired';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const removed = await sweepExpiredTokens();
  console.info('[cron] sweep-expired-tokens', removed);
  return NextResponse.json({ ok: true, removed });
}

export const GET = handle;
export const POST = handle;
