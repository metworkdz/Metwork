/**
 * GET /api/freelancer/contract — the caller's Metwork contract and whether
 * they may withdraw: { contract | null, profilePercent, withdrawBlock | null }.
 * Offers the contract first if the profile just reached 100 %.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { contractView, currentContract, offerContractIfEligible, profilePercent, withdrawalBlock } from '@/server/freelancer-contracts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  await offerContractIfEligible(guard.user.id);
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  if (!user) return jsonError(404, 'NOT_FOUND', 'User not found');
  const c = currentContract(data, user.id);
  return json({ contract: c ? contractView(c) : null, profilePercent: profilePercent(data, user), withdrawBlock: withdrawalBlock(data, user) });
}
