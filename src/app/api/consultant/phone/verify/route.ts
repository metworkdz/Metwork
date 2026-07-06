/**
 * POST /api/consultant/phone/verify  { code }
 *
 * Step 2 of consultant phone verification. Verifies the SMS OTP (constant-time,
 * single-use, expiry- and attempt-checked) and flips `phoneVerified` on the
 * consultant's own record. Session-guarded; mirrors the sign-in verify route's
 * error codes so the client error mapping is shared.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requireConsultant, verifyConsultantPhoneOtp } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  if (!(await checkRateLimitDistributed(`consultant-phone-verify:mentor:${guard.mentorId}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  const result = await verifyConsultantPhoneOtp(guard.mentorId, input.code);
  if (!result.ok) {
    switch (result.reason) {
      case 'EXPIRED':
        return jsonError(401, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
      case 'TOO_MANY_ATTEMPTS':
        return jsonError(429, 'OTP_LOCKED', 'Too many attempts. Request a new code.');
      default:
        return jsonError(401, 'INVALID_OTP', 'Invalid or expired code');
    }
  }

  await db.update((d) => {
    const m = (d.mentors ?? []).find((x) => x.id === guard.mentorId);
    if (!m) return;
    m.phoneVerified = true;
    m.updatedAt = new Date().toISOString();
  });

  return json({ ok: true });
}
