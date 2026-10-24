/**
 * The signed-in member's push subscription for this device.
 *   POST   { endpoint, keys: { p256dh, auth }, locale } → { ok }
 *   DELETE { endpoint } → 204
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { handleSubscribe, handleUnsubscribe } from '@/server/notifications/push-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['ENTREPRENEUR', 'FREELANCER', 'INVESTOR', 'INCUBATOR', 'ADMIN'] as const;

export async function POST(req: NextRequest) {
  const guard = await requireApiRole([...ROLES]);
  if (!guard.ok) return guard.response;
  return handleSubscribe(req, { type: 'USER', id: guard.user.id });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireApiRole([...ROLES]);
  if (!guard.ok) return guard.response;
  return handleUnsubscribe(req, { type: 'USER', id: guard.user.id });
}
