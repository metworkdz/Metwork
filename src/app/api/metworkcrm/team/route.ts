/** GET /api/metworkcrm/team — active internal_users, for the assignee picker. Read-only. */
import { json } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { listActiveTeamMembers } from '@/server/metworkcrm/services/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  return json({ rows: await listActiveTeamMembers() });
}
