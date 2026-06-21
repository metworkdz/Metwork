/**
 * POST /api/consultant/logout  { forgetDevice? }
 *
 * Clears the consultant portal session. When `forgetDevice` is set, also revokes
 * the remembered-device trust record and clears its cookie ("Forget this
 * device") — the next visit then requires a full email → OTP sign-in.
 */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import {
  clearMentorSessionCookie,
  deleteCurrentMentorSession,
  readMentorDeviceCookie,
  revokeMentorDeviceToken,
  clearMentorDeviceCookie,
} from '@/server/mentors/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let forgetDevice = false;
  try {
    const body = (await req.json()) as { forgetDevice?: boolean } | null;
    forgetDevice = Boolean(body?.forgetDevice);
  } catch {
    // No/invalid body → plain logout (session only).
  }

  await deleteCurrentMentorSession();
  await clearMentorSessionCookie();

  if (forgetDevice) {
    const deviceCookie = await readMentorDeviceCookie();
    if (deviceCookie) await revokeMentorDeviceToken(deviceCookie);
    await clearMentorDeviceCookie();
  }

  return json({ ok: true });
}
