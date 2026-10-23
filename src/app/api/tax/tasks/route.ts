/** GET /api/tax/tasks — the caller's tax calendar (freelancers and entrepreneurs). */
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { taxCenterFor } from '@/server/taxes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  if (!user) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json(taxCenterFor(data, user, new Date().toISOString().slice(0, 10)));
}
