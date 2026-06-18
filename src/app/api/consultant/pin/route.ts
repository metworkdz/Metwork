/**
 * Durable-token + PIN consultant access (parallel to the email magic-link).
 *
 *   GET  /api/consultant/pin?token=…  → { valid, pinSet } so the (future) UI
 *        can decide between the "set a PIN" and "enter your PIN" screens.
 *
 *   POST /api/consultant/pin           → first access sets the PIN; subsequent
 *        access verifies it. On success establishes the normal consultant
 *        session (so the rest of the portal API works unchanged) and, when
 *        `rememberDevice` is set, issues a remembered-device cookie.
 *        Body: { token, pin, rememberDevice? }
 *
 * PIN attempts are rate-limited per client IP + per resolved mentor.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import {
  resolveMentorIdByAccessToken,
  mentorHasPin,
  setMentorPin,
  verifyMentorPin,
  createMentorSession,
  setMentorSessionCookie,
  issueMentorDeviceToken,
  setMentorDeviceCookie,
  readMentorDeviceCookie,
  validateMentorDeviceToken,
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

const postSchema = z.object({
  token: z.string().min(1).max(512),
  // Optional: a remembered device may resume the session without re-typing it.
  pin: z.string().min(1).max(32).optional(),
  rememberDevice: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const mentorId = await resolveMentorIdByAccessToken(token);
  if (!mentorId) return json({ valid: false, pinSet: false });
  const pinSet = await mentorHasPin(mentorId);
  const deviceCookie = await readMentorDeviceCookie();
  const deviceRemembered = deviceCookie
    ? await validateMentorDeviceToken(mentorId, deviceCookie)
    : false;
  return json({ valid: true, pinSet, deviceRemembered });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let parsed;
  try {
    parsed = postSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const mentorId = await resolveMentorIdByAccessToken(parsed.token);
  // Generic 401 — never reveal whether a token is valid before rate-limiting.
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`consultant-pin:ip:${ip}`, 20, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  if (!mentorId) {
    return jsonError(401, 'INVALID_ACCESS', 'Invalid access link');
  }
  if (!(await checkRateLimitDistributed(`consultant-pin:mentor:${mentorId}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }

  const hadPin = await mentorHasPin(mentorId);

  // The PIN is the login. Two ways in:
  //   • with a PIN — first access SETS it, later access VERIFIES it;
  //   • without a PIN — only a remembered device on this browser may resume.
  if (parsed.pin) {
    if (!isValidPinFormat(parsed.pin)) {
      return jsonError(422, 'INVALID_PIN_FORMAT', 'PIN must be 4–6 digits');
    }
    if (!hadPin) {
      const set = await setMentorPin(mentorId, parsed.pin);
      if (!set.ok) {
        if (set.reason === 'NOT_FOUND') return jsonError(401, 'INVALID_ACCESS', 'Invalid access link');
        // ALREADY_SET (race with a concurrent set) — verify against what won.
        if (set.reason === 'ALREADY_SET' && !(await verifyMentorPin(mentorId, parsed.pin))) {
          return jsonError(401, 'WRONG_PIN', 'Incorrect PIN');
        }
      }
    } else if (!(await verifyMentorPin(mentorId, parsed.pin))) {
      return jsonError(401, 'WRONG_PIN', 'Incorrect PIN');
    }
  } else {
    if (!hadPin) {
      return jsonError(401, 'PIN_REQUIRED', 'Set your PIN to continue');
    }
    const deviceCookie = await readMentorDeviceCookie();
    const validDevice = deviceCookie
      ? await validateMentorDeviceToken(mentorId, deviceCookie)
      : false;
    if (!validDevice) {
      return jsonError(401, 'PIN_REQUIRED', 'Enter your PIN to continue');
    }
  }

  // Establish the standard consultant session so the whole portal works. Each
  // login is its own session, so a consultant can be signed in on many devices.
  const session = await createMentorSession(mentorId);
  await setMentorSessionCookie(session);

  // Only issue a new "remember this device" token on a fresh PIN login.
  let deviceRemembered = false;
  if (parsed.rememberDevice && parsed.pin) {
    const device = await issueMentorDeviceToken(mentorId, req.headers.get('user-agent'));
    await setMentorDeviceCookie(device);
    deviceRemembered = true;
  }

  return json({ ok: true, pinJustSet: Boolean(parsed.pin) && !hadPin, deviceRemembered });
}
