/**
 * GET  /api/academy/referral — my referral code and what it brought (signed in).
 * POST /api/academy/referral — { code }: a visitor arrived through a referral link; remember the code
 *      in an HttpOnly cookie for 30 days. The checkout reads it on the server.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { isAcademyEnabled } from '@/config/feature-flags';
import { REFERRAL_CODE_RE, REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, referralSummary } from '@/server/academy/referral';
import { parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const summary = await referralSummary(g.user.id);
  return summary ? json(summary) : jsonError(404, 'NOT_FOUND', 'Not found');
}

export async function POST(req: NextRequest) {
  if (!isAcademyEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limited = await rateLimited(`academy:ref:${ip}`, 30, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, z.object({ code: z.string().trim().toUpperCase().regex(REFERRAL_CODE_RE) }));
  if (!body.ok) return body.response;
  const exists = (await db.read()).users.some((u) => u.academyReferralCode === body.data.code);
  if (!exists) return jsonError(404, 'NOT_FOUND', 'Unknown code');
  const res = json({ ok: true });
  res.cookies.set(REFERRAL_COOKIE, body.data.code, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: REFERRAL_COOKIE_MAX_AGE,
  });
  return res;
}
