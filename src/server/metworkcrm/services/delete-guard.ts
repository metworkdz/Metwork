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
 * SCOPE NOTE — read before adding a new table with an anti-orphan CHECK that
 * references crm_organizations/crm_contacts/crm_opportunities/crm_startups/
 * crm_experts/crm_partnerships/crm_programs/crm_oi_projects: this only checks
 * the tables that currently have such a CHECK (`crm_tasks`,
 * `crm_interactions`, `crm_payments`) plus `crm_opportunities`/
 * `crm_partnerships` RESTRICT. A table with `ON DELETE SET NULL` but NO
 * anti-orphan CHECK of its own (`crm_startups.program_id`,
 * `crm_expert_missions.*`, the OI/program junctions) never needs a guard
 * here — it just silently loses the link, which is correct. The tell that
 * you're missing one: a delete returns 409 with the GENERIC catch-all
 * message ("des éléments y sont encore rattachés") instead of the specific
 * one from `formatDeleteGuardMessage` — that means the pre-check said
 * canDelete:true but the DB threw anyway. `crm_payments` was exactly this
 * bug once (see the `checkLeafEntityGuard` comment below) — caught by
 * browser verification, not by tests, because no test exercised a payment
 * being a program's sole link until Prompt 4 gave Payments its first write
 * path.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CrmDatabase } from '../db/client';
import {
  crmContactOrganizations,
  crmInteractions,
  crmOpportunities,
  crmPartnerships,
  crmPayments,
  crmTasks,
} from '../db/schema';

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

type LinkColumnName =
  | 'organization_id' | 'contact_id' | 'opportunity_id' | 'startup_id'
  | 'expert_id' | 'partnership_id' | 'program_id' | 'oi_project_id'
  | 'booking_id' | 'payment_id' | 'space_booking_id';

/**
 * crm_payments has its OWN anti-orphan CHECK (schema doc §0), same failure
 * mode as crm_tasks/crm_interactions: deleting a row this links to SET NULLs
 * the column, and if that was the payment's only link the CHECK fires. It has
 * no startup_id/expert_id column, so only applies when the deleted entity's
 * link column is one of these.
 */
const PAYMENT_LINK_COLUMNS = [
  'opportunity_id', 'space_booking_id', 'program_id',
  'organization_id', 'contact_id', 'partnership_id', 'oi_project_id',
];

/** Count rows where `linkColumn = id` and every OTHER link column on that table is NULL. */
async function countOrphanedBy(
  db: CrmDatabase,
  table: typeof crmTasks | typeof crmInteractions | typeof crmPayments,
  linkColumn: LinkColumnName,
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

const PAYMENT_OTHER_LINKS_FOR_ORG = PAYMENT_LINK_COLUMNS.filter((c) => c !== 'organization_id');
const PAYMENT_OTHER_LINKS_FOR_CONTACT = PAYMENT_LINK_COLUMNS.filter((c) => c !== 'contact_id');

export async function checkOrganizationDeleteGuard(
  db: CrmDatabase,
  organizationId: string,
): Promise<DeleteGuardResult> {
  const [orphanTasks, orphanInteractions, orphanPayments, soleOpportunities, partnershipCount, linkedContacts] = await Promise.all([
    countOrphanedBy(db, crmTasks, 'organization_id', organizationId, TASK_OTHER_LINKS_FOR_ORG),
    countOrphanedBy(db, crmInteractions, 'organization_id', organizationId, INTERACTION_OTHER_LINKS_FOR_ORG),
    countOrphanedBy(db, crmPayments, 'organization_id', organizationId, PAYMENT_OTHER_LINKS_FOR_ORG),
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
    { label: 'paiements sans autre lien', count: orphanPayments },
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
  const [orphanTasks, orphanInteractions, orphanPayments, soleOpportunities, linkedOrgs] = await Promise.all([
    countOrphanedBy(db, crmTasks, 'contact_id', contactId, TASK_OTHER_LINKS_FOR_CONTACT),
    countOrphanedBy(db, crmInteractions, 'contact_id', contactId, INTERACTION_OTHER_LINKS_FOR_CONTACT),
    countOrphanedBy(db, crmPayments, 'contact_id', contactId, PAYMENT_OTHER_LINKS_FOR_CONTACT),
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
    { label: 'paiements sans autre lien', count: orphanPayments },
    { label: 'opportunités sans autre lien', count: soleOpportunities },
  ].filter((b) => b.count > 0);

  const cascades: DeleteBlocker[] = [
    { label: 'liens organisation supprimés', count: linkedOrgs },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades };
}

/** The 8 link columns shared by crm_tasks and crm_interactions (LINK_COLUMNS in db/schema.ts). */
const ALL_LINK_COLUMNS = [
  'contact_id', 'organization_id', 'opportunity_id', 'startup_id',
  'expert_id', 'partnership_id', 'program_id', 'oi_project_id',
];
/** crm_tasks alone also has these two — a task can be orphan-free via either. */
const TASK_ONLY_LINK_COLUMNS = ['booking_id', 'payment_id'];

/**
 * Shared shape for the leaf-entity guards. Each risks orphaning a Task or
 * Interaction; opportunity/partnership/program/oi_project ALSO risk
 * orphaning a Payment (crm_payments has no startup_id/expert_id column, so
 * those two skip the payment check — this bit us once: see git history on
 * this file for the 409 that surfaced it during Prompt 4 verification).
 */
async function checkLeafEntityGuard(
  db: CrmDatabase,
  linkColumn: 'opportunity_id' | 'startup_id' | 'expert_id' | 'partnership_id' | 'program_id' | 'oi_project_id',
  id: string,
): Promise<DeleteGuardResult> {
  const otherColumns = ALL_LINK_COLUMNS.filter((c) => c !== linkColumn);
  const paymentApplies = (PAYMENT_LINK_COLUMNS as string[]).includes(linkColumn);
  const [orphanTasks, orphanInteractions, orphanPayments] = await Promise.all([
    countOrphanedBy(db, crmTasks, linkColumn, id, [...otherColumns, ...TASK_ONLY_LINK_COLUMNS]),
    countOrphanedBy(db, crmInteractions, linkColumn, id, otherColumns),
    paymentApplies
      ? countOrphanedBy(db, crmPayments, linkColumn, id, PAYMENT_LINK_COLUMNS.filter((c) => c !== linkColumn))
      : Promise.resolve(0),
  ]);

  const blockers: DeleteBlocker[] = [
    { label: 'tâches sans autre lien', count: orphanTasks },
    { label: 'interactions sans autre lien', count: orphanInteractions },
    { label: 'paiements sans autre lien', count: orphanPayments },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades: [] };
}

export async function checkOpportunityDeleteGuard(db: CrmDatabase, opportunityId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'opportunity_id', opportunityId);
}

export async function checkStartupDeleteGuard(db: CrmDatabase, startupId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'startup_id', startupId);
}

export async function checkExpertDeleteGuard(db: CrmDatabase, expertId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'expert_id', expertId);
}

export async function checkPartnershipDeleteGuard(db: CrmDatabase, partnershipId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'partnership_id', partnershipId);
}

/**
 * Programs/OI Projects: every OTHER table that references them
 * (`crm_startups.program_id`, `crm_expert_missions.*`, the participant/
 * trainer/partner junctions, `crm_oi_startups`/`crm_oi_experts`) uses SET
 * NULL or CASCADE, never RESTRICT. `crm_payments` is the one exception worth
 * naming: SET NULL, but it carries its OWN anti-orphan CHECK, so
 * `checkLeafEntityGuard` checks it too, same as Task/Interaction.
 */
export async function checkProgramDeleteGuard(db: CrmDatabase, programId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'program_id', programId);
}

export async function checkOiProjectDeleteGuard(db: CrmDatabase, oiProjectId: string): Promise<DeleteGuardResult> {
  return checkLeafEntityGuard(db, 'oi_project_id', oiProjectId);
}

/**
 * Space Bookings: `crm_tasks.booking_id` and `crm_payments.space_booking_id`
 * are the only two columns that reference a booking. Interactions have no
 * booking_id column at all (schema §5) — only Tasks and Payments can orphan.
 */
export async function checkSpaceBookingDeleteGuard(db: CrmDatabase, bookingId: string): Promise<DeleteGuardResult> {
  const [orphanTasks, orphanPayments] = await Promise.all([
    countOrphanedBy(db, crmTasks, 'booking_id', bookingId, [...ALL_LINK_COLUMNS, 'payment_id']),
    countOrphanedBy(db, crmPayments, 'space_booking_id', bookingId, PAYMENT_LINK_COLUMNS.filter((c) => c !== 'space_booking_id')),
  ]);

  const blockers: DeleteBlocker[] = [
    { label: 'tâches sans autre lien', count: orphanTasks },
    { label: 'paiements sans autre lien', count: orphanPayments },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades: [] };
}

/**
 * Payments: only `crm_tasks.payment_id` references a payment — Interactions
 * have no payment_id column, and nothing else in the schema links to
 * crm_payments.id.
 */
export async function checkPaymentDeleteGuard(db: CrmDatabase, paymentId: string): Promise<DeleteGuardResult> {
  const orphanTasks = await countOrphanedBy(db, crmTasks, 'payment_id', paymentId, [...ALL_LINK_COLUMNS, 'booking_id']);

  const blockers: DeleteBlocker[] = [
    { label: 'tâches sans autre lien', count: orphanTasks },
  ].filter((b) => b.count > 0);

  return { canDelete: blockers.length === 0, blockers, cascades: [] };
}

export function formatDeleteGuardMessage(entity: string, result: DeleteGuardResult): string {
  const parts = result.blockers.map((b) => `${b.count} ${b.label}`);
  return `Impossible de supprimer ${entity} : ${parts.join(', ')}. Archivez-la plutôt, ou détachez d'abord ces éléments.`;
}
