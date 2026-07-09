/**
 * Vercel Cron — Consultation pre-session reminders (consultant).
 *
 * Schedule: every 15 minutes (see vercel.json — the client pass targets "1h
 * before", so an hourly tick would be too coarse). Two passes, each one-shot
 * per booking via an atomic claim, so overlapping runs never double-send:
 *   • consultant: meeting details (or "add your meeting link" warning) for
 *     sessions starting within 24h;
 *   • client: email + WhatsApp→SMS with the meeting details for READY sessions
 *     starting within 1h.
 * Secured by the same `CRON_SECRET` as the other cron routes.
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
    clientSent: result.clientSent,
    skippedNoMentor: result.skippedNoMentor,
  });
}
