/**
 * Vercel Cron — Startup Academy "keep going" emails, daily at 10:00: one per
 * learner and course idle for 7–14 days, at most three per course. Idempotent
 * (each send is claimed in the store first). Secured by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { runAcademyReminders } from '@/server/academy/notify';

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
  const reminders = await runAcademyReminders();
  console.info('[cron] academy-reminders', reminders);
  return NextResponse.json({ ok: true, reminders });
}

export const GET = handle;
export const POST = handle;
