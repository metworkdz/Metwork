/** GET /api/admin/refunds/[id]/account — the full account number, for the admin about to send the transfer. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { getRefundAccount } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const account = await getRefundAccount(id);
  if (!account) return jsonError(404, 'NOT_FOUND', 'No account on file');
  return json({ account });
}
