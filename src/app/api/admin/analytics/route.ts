/**
 * GET /api/admin/analytics
 *
 * Returns detailed benefit & pricing analytics for the admin dashboard:
 *  - Membership breakdown (active tiers, revenue, promo discounts)
 *  - Free consultation sessions given (count + estimated DZD value)
 *  - Network Pass coworking sessions (count + credit utilisation)
 *  - Estimated space-booking membership discounts
 *  - Month-by-month trend for the current calendar year
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { buildAdminAnalytics } from '@/server/analytics/admin-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  return json(await buildAdminAnalytics());
}
