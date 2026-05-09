/**
 * GET /api/startups/saved
 * Returns the current investor's saved startup listings (full listing objects).
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { toStartupDto } from '@/server/startups/serialize';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const savedIds = new Set(
    (data.savedStartups ?? [])
      .filter((s) => s.userId === guard.user.id)
      .map((s) => s.startupId),
  );

  const listings = data.startupListings
    .filter((l) => savedIds.has(l.id) && l.status === 'ACTIVE')
    .map(toStartupDto);

  return json({ items: listings, total: listings.length });
}
