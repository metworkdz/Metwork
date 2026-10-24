/**
 * The signed-in consultant's push subscription for this device (portal PWA).
 *   POST   { endpoint, keys: { p256dh, auth }, locale } → { ok }
 *   DELETE { endpoint } → 204
 */
import type { NextRequest } from 'next/server';
import { requireConsultant } from '@/server/mentors/access';
import { handleSubscribe, handleUnsubscribe } from '@/server/notifications/push-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return handleSubscribe(req, { type: 'MENTOR', id: guard.mentorId });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  return handleUnsubscribe(req, { type: 'MENTOR', id: guard.mentorId });
}
