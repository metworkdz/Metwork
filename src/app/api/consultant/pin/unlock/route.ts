/**
 * Trusted-device PIN unlock.
 *
 *   GET  /api/consultant/pin/unlock  → { trusted } so the entry screen knows
 *        whether this browser is a remembered device (and may show PIN unlock).
 *
 *   POST /api/consultant/pin/unlock  { pin } → verifies the PIN for the mentor
 *        bound to the device-trust cookie and, on success, mints a fresh
 *        consultant session. No session or admin token is required — the device
 *        cookie identifies the mentor; the PIN authenticates.
 *
 * Attempts are rate-limited per client IP and per resolved mentor. After the
 * limit trips the client falls back to the full email → OTP path.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import {
  readMentorDeviceCookie,
  resolveMentorIdByDeviceToken,
  verifyMentorPin,
  createMentorSession,
  setMentorSessionCookie,
  isValidPinFormat,
} from '@/server/mentors/access';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

const schema = z.object({ pin: z.string().min(1).max(32) });

export async function GET() {
  const deviceCookie = await readMentorDeviceCookie();
  const mentorId = deviceCookie ? await resolveMentorIdByDeviceToken(deviceCookie) : null;
  return json({ trusted: Boolean(mentorId) });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let parsed;
  try { parsed = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Rate-limit by IP before resolving the device, so a stolen/guessed cookie
  // can't be paired with unlimited PIN guesses.
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`consultant-unlock:ip:${ip}`, 20, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Use email sign-in instead.');
  }

  const deviceCookie = await readMentorDeviceCookie();
  const mentorId = deviceCookie ? await resolveMentorIdByDeviceToken(deviceCookie) : null;
  if (!mentorId) {
    // Not a trusted device (cookie missing / expired / revoked). The client
    // routes the user to the full email → OTP sign-in.
    return jsonError(401, 'DEVICE_NOT_TRUSTED', 'This device is not remembered');
  }

  if (!(await checkRateLimitDistributed(`consultant-unlock:mentor:${mentorId}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Use email sign-in instead.');
  }

  if (!isValidPinFormat(parsed.pin)) {
    return jsonError(422, 'INVALID_PIN_FORMAT', 'PIN must be 4–6 digits');
  }
  if (!(await verifyMentorPin(mentorId, parsed.pin))) {
    return jsonError(401, 'WRONG_PIN', 'Incorrect PIN');
  }

  const session = await createMentorSession(mentorId);
  await setMentorSessionCookie(session);
  return json({ ok: true });
}
