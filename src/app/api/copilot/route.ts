/** GET /api/copilot — the caller's monthly quota and whether the knowledge base is ready. */
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { quotaFor } from '@/server/copilot/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  if (!user) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json({ quota: quotaFor(data, user), kb: data.copilotKb ? { builtAt: data.copilotKb.builtAt, documents: data.copilotKb.documents } : null });
}
