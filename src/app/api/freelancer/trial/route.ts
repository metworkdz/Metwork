/**
 * POST /api/freelancer/trial — start the free Premium month earned at 100 %
 * profile completion. All rules live in `startPremiumTrial`.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { startPremiumTrial } from '@/server/freelancers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES = {
  NOT_ON_SALE: [409, 'Premium is not open yet. Your free month stays unlocked.'],
  NOT_UNLOCKED: [422, 'Complete your profile to 100 % first.'],
  ALREADY_USED: [409, 'You have already used your free month.'],
  DOCUMENT_ALREADY_USED: [409, 'A free month was already used with this business document.'],
  ALREADY_PAID: [409, 'You already have a paid plan.'],
  NOT_FOUND: [404, 'Profile not found'],
} as const;

export async function POST() {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const result = await startPremiumTrial(guard.user.id);
  if (!result.ok) {
    const [status, message] = MESSAGES[result.reason];
    return jsonError(status, result.reason, message);
  }
  return json({ expiresAt: result.expiresAt }, { status: 201 });
}
