/**
 * METWORK OS CRM — read-only team roster, for the assignee picker.
 *
 * NOT user management (create/deactivate/change-role is /metworkcrm/users,
 * Prompt 8). This lists active internal_users only.
 */
import { eq } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { internalUsers } from '../db/schema';

export interface TeamMemberOption {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'TEAM_MEMBER';
}

export async function listActiveTeamMembers(): Promise<TeamMemberOption[]> {
  const rows = await getCrmDb()
    .select({ id: internalUsers.id, name: internalUsers.name, email: internalUsers.email, role: internalUsers.role })
    .from(internalUsers)
    .where(eq(internalUsers.isActive, true));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
