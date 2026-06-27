/**
 * GET /api/admin/payouts/payable-users — payable targets (users + mentors) with
 * wallet balance + masked payout-account status. Admin only. Optional `search`
 * (name) and `role` query filters.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { getPayableTargets } from '@/server/payouts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const search = req.nextUrl.searchParams.get('search') ?? undefined;
  const role = req.nextUrl.searchParams.get('role') ?? undefined;

  const items = await getPayableTargets({ search, role });
  return json({ items, total: items.length });
}
