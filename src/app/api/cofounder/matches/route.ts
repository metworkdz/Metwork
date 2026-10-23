/** GET /api/cofounder/matches — the caller's matches (names revealed: both liked each other). */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { matchesFor } from '@/server/cofounder/service';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  return withCofounder(async () => json({ matches: await matchesFor(guard.user.id) }));
}
