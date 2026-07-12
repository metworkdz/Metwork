/**
 * POST /api/perks/:id/claim — claim a perk for the current user.
 *
 * Fully atomic: perk state, tier eligibility, duplicate-claim and stock
 * checks all re-run inside the claim's db.update() lock (see claimPerk).
 * The low-stock admin email fires AFTER the lock, fire-and-forget — it can
 * never block or fail the claim response.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { claimPerk } from '@/server/perks/service';
import { sendPerkLowStockNotification } from '@/server/perks/notify';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await claimPerk(guard.user.id, id);

  if (!result.ok) {
    switch (result.reason) {
      case 'PERK_NOT_FOUND':
      case 'USER_NOT_FOUND':
        return jsonError(404, 'NOT_FOUND', 'Perk not found');
      case 'PERK_INACTIVE':
        return jsonError(410, 'PERK_INACTIVE', 'This perk is no longer available');
      case 'TIER_TOO_LOW':
        return jsonError(403, 'TIER_TOO_LOW', 'Your membership tier does not include this perk');
      case 'ALREADY_CLAIMED':
        return jsonError(409, 'ALREADY_CLAIMED', 'You have already claimed this perk');
      case 'OUT_OF_STOCK':
        return jsonError(
          409,
          'OUT_OF_STOCK',
          'All codes for this perk have been claimed — check back after restock',
        );
    }
  }

  if (result.kind === 'CODE_POOL') {
    // Non-blocking by construction: void-returning fire-and-forget.
    if (result.lowStock) sendPerkLowStockNotification(result.lowStock);
    return json({ kind: 'CODE_POOL', code: result.code });
  }

  return json({
    kind: 'VOUCHER',
    code: result.code,
    issuedAt: result.issuedAt,
    verifyPath: result.verifyPath,
  });
}
