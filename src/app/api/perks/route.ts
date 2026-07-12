/**
 * GET /api/perks — perks visible to the current user: active AND effective
 * tier ≥ perk.minTier (via getEffectiveMembershipCode through the perks
 * service's single meetsMinTier gate). Includes per-perk claim status and,
 * when claimed, the assigned code / voucher info.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { listPerksForUser } from '@/server/perks/service';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const perks = await listPerksForUser(guard.user);
  return json({ items: perks, total: perks.length });
}
