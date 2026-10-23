/** GET /api/cofounder/deck — today's cards, the daily allowance and the number of likes waiting. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { deckFor } from '@/server/cofounder/service';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Building the day's deck can include one AI call.
export const maxDuration = 60;

export async function GET() {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  return withCofounder(async () => json(await deckFor(guard.user.id)));
}
