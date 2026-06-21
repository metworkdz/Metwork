/**
 * POST /api/consultant/pin/set  { pin, rememberDevice? }
 *
 * First-time PIN creation, immediately after an OTP sign-in. Requires a live
 * consultant session. The PIN is scrypt-hashed via the existing password util
 * (never stored or logged in plaintext). When `rememberDevice` is set, issues a
 * 60-day device-trust token (hashed at rest) and sets the HttpOnly device
 * cookie so the consultant can later unlock with just the PIN on this browser.
 *
 * Idempotency: if a PIN already exists this returns ALREADY_SET rather than
 * overwriting — rotation goes through PATCH /api/consultant/pin/change.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import {
  requireConsultant,
  setMentorPin,
  issueMentorDeviceToken,
  setMentorDeviceCookie,
  isValidPinFormat,
} from '@/server/mentors/access';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  pin: z.string().min(1).max(32),
  rememberDevice: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let parsed;
  try { parsed = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  if (!isValidPinFormat(parsed.pin)) {
    return jsonError(422, 'INVALID_PIN_FORMAT', 'PIN must be 4–6 digits');
  }

  const set = await setMentorPin(guard.mentorId, parsed.pin);
  if (!set.ok) {
    if (set.reason === 'ALREADY_SET') {
      return jsonError(409, 'PIN_ALREADY_SET', 'A PIN is already set for this account');
    }
    if (set.reason === 'INVALID_FORMAT') {
      return jsonError(422, 'INVALID_PIN_FORMAT', 'PIN must be 4–6 digits');
    }
    return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  }

  let deviceRemembered = false;
  if (parsed.rememberDevice) {
    const device = await issueMentorDeviceToken(guard.mentorId, req.headers.get('user-agent'));
    await setMentorDeviceCookie(device);
    deviceRemembered = true;
  }

  return json({ ok: true, deviceRemembered });
}
