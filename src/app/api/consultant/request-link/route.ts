/**
 * POST /api/consultant/request-link  { email, locale? }
 *
 * Emails a single-use magic link to a consultant (mentor). Always returns 200
 * regardless of whether the email matches a mentor — no account enumeration.
 * Rate-limited. Flag-gated behind CONSULTATION_INSTANT_BOOK.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { issueMentorMagicLink } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendConsultantMagicLinkEmail } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email().max(200),
  locale: z.enum(['en', 'fr', 'ar']).optional(),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`consultant-link:${ip}:${input.email.toLowerCase()}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  const issued = await issueMentorMagicLink(input.email);
  if (issued && issued.mentor.email) {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/$/, '');
    const locale = input.locale ?? 'fr';
    const link = `${base}/api/consultant/verify?token=${issued.token}&locale=${locale}`;
    sendConsultantMagicLinkEmail(issued.mentor.email, link, locale === 'en' ? 'en' : 'fr');
  }

  // Always 200 — never reveal whether the email matched a consultant.
  return json({ ok: true });
}
