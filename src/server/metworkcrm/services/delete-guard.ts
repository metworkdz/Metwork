/**
 * METWORK OS CRM — pre-delete orphan/blocker checks for Organizations and
 * Contacts.
 *
 * Prompt 1's tests surfaced a real interaction between the schema's two
 * integrity mechanisms: deleting a row that a Task/Interaction/Opportunity is
 * linked to sets that link column to NULL (`ON DELETE SET NULL`); if that was
 * the dependent row's ONLY link, the anti-orphan `CHECK` on the dependent row
 * fires and SQLite rolls back the WHOLE delete. That's the correct, fail-closed
 * behaviour — but surfacing a raw `SQLITE_CONSTRAINT_CHECK` to the CRM UI is
 * not. This module pre-computes the same condition so the API can return a
 * readable 409 instead ("archive it, or unlink these first").
 *
 * SCOPE NOTE — read before adding a new table that references
 * crm_organizations or crm_contacts: this only checks the tables Prompt 2
 * populates (`crm_tasks`, `crm_interactions`, `crm_opportunities`,
 * `crm_contact_organizations`) plus `crm_partnerships` (RESTRICT, checked
 * because it always blocks regardless of other links, even though nothing
 * populates it until Prompt 3). Every later prompt that adds a link column
 * into Organizations/Contacts (crm_startups, crm_experts, crm_program_*,
 * crm_space_bookings, crm_payments, crm_oi_projects…) MUST extend the
 * blocker list here, or a delete on a row one of those tables depends on will
 * throw a raw SQLite error again instead of a friendly 409.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CrmDatabase } from '../db/client';
import { crmContactOrganizations, crmInteractions, crmOpportunities, crmPartnerships, crmTasks } from '../db/schema';

export interface DeleteBlocker {
  /** French, user-facing label — shown verbatim in the 409 message. */
  label: string;
  count: number;
}

export interface DeleteGuardResult {
  canDelete: boolean;
  /** Would become orphaned, or is RESTRICTed — deletion refused until resolved. */
  blockers: DeleteBlocker[];
  /** Merely loses this link (SET NULL) or is a junction row (CASCADE) — informational only. */
  cascades: DeleteBlocker[];
}

/** Count rows where `linkColumn = id` and every OTHER link column on that table is NULL. */
async function countOrphanedBy(
  db: CrmDatabase,
  table: typeof crmTasks | typeof crmInteractions,
  linkColumn: 'organization_id' | 'contact_id',
  id: string,
  otherLinkColumns: string[],
): Promise<number> {
  const otherNullClauses = otherLinkColumns.map((c) => sql.raw(`"${c}" IS NULL`));
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(sql`${sql.raw(`"${linkColumn}"`)} = ${id} AND ${sql.join(otherNullClauses, sql` AND `)}`);
  return Number(rows[0]?.n ?? 0);
}

const TASK_OTHER_LINKS_FOR_ORG = [
  'contact_id', 'opportunity_id', 'startup_id', 'expert_id', 'partnership_id',
  'program_id', 'oi_project_id', 'booking_id', 'payment_id',
];
const TASK_OTHER_LINKS_FOR_CONTACT = [
  'organization_id', 'opportunity_id', 'startup_id', 'expert_id', 'partnership_id',
  'program_id', 'oi_project_id', 'booking_id', 'payment_id',
];
const INTERACTION_OTHER_LINKS_FOR_ORG = [
  'contact_id', 'opportunity_id', 'startup_id', 'expert_id', 'partnership_id', 'program_id', 'oi_project_id',
];
const INTERACTION_OTHER_LINKS_FOR_CONTACT = [
  'organization_id', 'opportunity_id', 'startup_id', 'expert_id', 'partnership_id', 'program_id', 'oi_project_id',
];

export async function checkOrganizationDeleteGuard(
  db: CrmDatabase,
  organizationId: string,
): Promise<DeleteGuardResult> {
  const [orphanTasks, orphanInteractions, soleOpportunities, partnershipCount, linkedContacts] = await Promise.all([
    countOrphanedBy(db, crmTasks, 'organization_id', organizationId, TASK_OTHER_LINKS_FOR_ORG),
    countOrphanedBy(db, crmInteractions, 'organization_id', organizationId, INTERACTION_OTHER_LINKS_FOR_ORG),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, organizationId), isNull(crmOpportunities.contactId)))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmPartnerships)
      .where(eq(crmPartnerships.organizationId, organizationId))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmContactOrganizations)
      .where(eq(crmContactOrganizations.organizationId, organizationId))
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  const blockers: DeleteBlocker[] = [
    { label: 'tâches sans autre lien', count: orphanTasks },
    { label: 'interactions sans autre lien', count: orphanInteractions },
    { label: 'opportunités sans autre lien', count: soleOpportunities },
    { label: 'partenariats actifs', count: partnershipCount },
  ].filter((b) => b.count > 0);

  const cascades: DeleteBlocker[] = [
    { label: 'liens contact supprimés', count: linkedContacts },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades };
}

export async function checkContactDeleteGuard(
  db: CrmDatabase,
  contactId: string,
): Promise<DeleteGuardResult> {
  const [orphanTasks, orphanInteractions, soleOpportunities, linkedOrgs] = await Promise.all([
    countOrphanedBy(db, crmTasks, 'contact_id', contactId, TASK_OTHER_LINKS_FOR_CONTACT),
    countOrphanedBy(db, crmInteractions, 'contact_id', contactId, INTERACTION_OTHER_LINKS_FOR_CONTACT),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.contactId, contactId), isNull(crmOpportunities.organizationId)))
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmContactOrganizations)
      .where(eq(crmContactOrganizations.contactId, contactId))
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  const blockers: DeleteBlocker[] = [
    { label: 'tâches sans autre lien', count: orphanTasks },
    { label: 'interactions sans autre lien', count: orphanInteractions },
    { label: 'opportunités sans autre lien', count: soleOpportunities },
  ].filter((b) => b.count > 0);

  const cascades: DeleteBlocker[] = [
    { label: 'liens organisation supprimés', count: linkedOrgs },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades };
}

export function formatDeleteGuardMessage(entity: string, result: DeleteGuardResult): string {
  const parts = result.blockers.map((b) => `${b.count} ${b.label}`);
  return `Impossible de supprimer ${entity} : ${parts.join(', ')}. Archivez-la plutôt, ou détachez d'abord ces éléments.`;
}
