/**
 * Vercel Cron — Consultation pre-session reminders (consultant).
 *
 * Schedule: `0 * * * *` (hourly). Emails the consultant the meeting details
 * (or an "add your meeting link" warning for AWAITING_LINK bookings) for every
 * settled instant-book consultation starting within the next 24 hours. One
 * reminder per booking, ever — the claim is atomic, so overlapping runs never
 * double-send. Secured by the same `CRON_SECRET` as the other cron routes.
 */
import { NextResponse } from 'next/server';
import { sendConsultationRemindersDue } from '@/server/notifications/consultation-reminder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  // Allow unauthenticated access only in test environments.
  if (!cronSecret) {
    return process.env.NODE_ENV === 'test';
  }
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await sendConsultationRemindersDue();

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    skippedNoMentor: result.skippedNoMentor,
  });
}
