/** GET /api/admin/payments/incoming — money collected through Metwork (cards + wallets) with summary figures. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json } from '@/server/http/json';
import { getIncomingView } from '@/server/payments/incoming';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  return json(await getIncomingView());
}
