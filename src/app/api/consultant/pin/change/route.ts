/**
 * PATCH /api/consultant/pin/change — change the access PIN. Requires a live
 * consultant session and the current PIN. Changing the PIN revokes all
 * remembered devices (the consultant re-trusts devices afterwards). The
 * consultant can call this any time from their account.
 * Body: { currentPin, newPin }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireConsultant, changeMentorPin, clearMentorDeviceCookie } from '@/server/mentors/access';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPin: z.string().min(1).max(32),
  newPin: z.string().min(1).max(32),
});

export async function PATCH(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  if (!(await checkRateLimitDistributed(`consultant-pin-change:${guard.mentorId}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let parsed;
  try {
    parsed = schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await changeMentorPin(guard.mentorId, parsed.currentPin, parsed.newPin);
  if (!result.ok) {
    switch (result.reason) {
      case 'INVALID_FORMAT':
        return jsonError(422, 'INVALID_PIN_FORMAT', 'PIN must be 4–6 digits');
      case 'WRONG_PIN':
        return jsonError(401, 'WRONG_PIN', 'Current PIN is incorrect');
      case 'NO_PIN':
        return jsonError(409, 'NO_PIN', 'No PIN set yet');
      default:
        return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
    }
  }

  // Devices were revoked server-side; clear this device's cookie too.
  await clearMentorDeviceCookie();
  return json({ ok: true });
}
