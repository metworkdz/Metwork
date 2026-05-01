/**
 * GET /api/startups/:id — authenticated; returns any ACTIVE listing,
 *                         or the founder's own listing regardless of status.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const listing = await findStartupById(id);

  if (!listing) {
    return jsonError(404, 'STARTUP_NOT_FOUND', 'Startup listing not found');
  }

  // Non-founders can only see active listings.
  if (listing.status !== 'ACTIVE' && listing.founderId !== guard.user.id) {
    return jsonError(404, 'STARTUP_NOT_FOUND', 'Startup listing not found');
  }

  return json(toStartupDto(listing));
}
