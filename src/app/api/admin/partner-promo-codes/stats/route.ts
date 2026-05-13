/**
 * GET /api/admin/partner-promo-codes/stats?partnerId=<uuid>
 * Return aggregate promo code stats for a partner.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { getPromoCodeStats } from '@/server/network/partner-promo-service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const partnerId = new URL(req.url).searchParams.get('partnerId');
  if (!partnerId) {
    return jsonError(400, 'MISSING_PARAM', 'partnerId is required');
  }

  try {
    const stats = await getPromoCodeStats(partnerId);
    return json(stats);
  } catch (err) {
    console.error('[partner-route]', err);
    return jsonError(500, 'STATS_ERROR', 'An unexpected error occurred');
  }
}
