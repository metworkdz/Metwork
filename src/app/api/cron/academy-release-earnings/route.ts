/**
 * Vercel Cron — Startup Academy: course sales past the 7-day refund window move
 * their mentors' earnings from held to withdrawable, referral rewards past the
 * window are credited, and gifts unclaimed for 30 days are refunded.
 *
 * Schedule: `15 3 * * *` (daily). Works on GET (what Vercel Cron sends) and
 * POST. Logic in `releaseAcademyEarnings` (idempotent). Secured by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { releaseAcademyEarnings } from '@/server/academy/orders';
import { refundExpiredGifts } from '@/server/academy/gifts';

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
  const result = { ...(await releaseAcademyEarnings()), gifts: await refundExpiredGifts() };
  console.info('[cron] academy-release-earnings', result);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
