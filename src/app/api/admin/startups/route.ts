/**
 * GET /api/admin/startups — admin-only. Lists every startup listing
 * regardless of status (DRAFT included), with founder name/email joined in.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { toStartupDto } from '@/server/startups/serialize';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const usersById = new Map(data.users.map((u) => [u.id, u]));

  const items = data.startupListings
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((listing) => {
      const founder = usersById.get(listing.founderId);
      return {
        ...toStartupDto(listing),
        founderName: founder?.fullName ?? null,
        founderEmail: founder?.email ?? null,
      };
    });

  return json({ items, total: items.length });
}
