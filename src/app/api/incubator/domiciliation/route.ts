/**
 * GET /api/incubator/domiciliation — list this incubator's domiciliation
 * requests (address-slot enquiries), newest first.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const data = await db.read();
  const items = (data.domiciliationRequests ?? [])
    .filter((r) => r.incubatorId === inc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items, total: items.length });
}
