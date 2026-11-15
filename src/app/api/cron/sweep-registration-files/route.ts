/**
 * Vercel Cron — daily: delete registration files that nothing references
 * (uploaded but never submitted, replaced, or left behind by a failed delete)
 * and that are over a day old. Idempotent. Secured by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { sweepRegistrationFiles } from '@/server/registrations/file-cleanup';

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
  const result = await sweepRegistrationFiles();
  console.info('[cron] sweep-registration-files', result);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
