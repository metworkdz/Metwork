/**
 * METWORK OS CRM — Contacts service.
 *
 * `crm_contacts.primary_organization_id` is a DENORMALIZED convenience column
 * — the actual N–N relationship lives in `crm_contact_organizations`. This
 * service is the ONLY writer of `primary_organization_id`; it keeps it in
 * sync with whichever linked organization (if any) has `is_primary = true`
 * every time the link set is replaced. Never write that column from anywhere
 * else, or the two can drift.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContactOrganizations,
  crmContacts,
  crmInteractions,
  crmOpportunities,
  crmOrganizations,
  crmTasks,
} from '../db/schema';
import type { ContactInput } from '../validation/contacts';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkContactDeleteGuard, formatDeleteGuardMessage } from './delete-guard';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface ContactListFilters {
  q?: string;
  status?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}

export async function listContacts(filters: ContactListFilters) {
  const db = getCrmDb();

  // Filtering by organization requires the junction table, so this path
  // joins; the common case (no org filter) stays a single-table scan.
  if (filters.organizationId) {
    const clauses = [
      eq(crmContactOrganizations.organizationId, filters.organizationId),
      filters.status ? eq(crmContacts.status, filters.status as never) : undefined,
      filters.q
        ? sql`(${crmContacts.fullName} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE OR ${crmContacts.email} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
        : undefined,
    ].filter(Boolean);
    const where = and(...clauses);

    const [rows, totalRows] = await Promise.all([
      db
        .select({ contact: crmContacts })
        .from(crmContactOrganizations)
        .innerJoin(crmContacts, eq(crmContactOrganizations.contactId, crmContacts.id))
        .where(where)
        .orderBy(desc(crmContacts.updatedAt))
        .limit(filters.limit)
        .offset(filters.offset),
      db
        .select({ n: sql<number>`count(*)` })
        .from(crmContactOrganizations)
        .innerJoin(crmContacts, eq(crmContactOrganizations.contactId, crmContacts.id))
        .where(where),
    ]);
    return { rows: rows.map((r) => r.contact), total: Number(totalRows[0]?.n ?? 0) };
  }

  const clauses = [
    filters.status ? eq(crmContacts.status, filters.status as never) : undefined,
    filters.q
      ? sql`(${crmContacts.fullName} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE OR ${crmContacts.email} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmContacts)
      .where(where)
      .orderBy(desc(crmContacts.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmContacts).where(where),
  ]);
  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function getContactDetail(id: string) {
  const db = getCrmDb();
  const contact = (await db.select().from(crmContacts).where(eq(crmContacts.id, id)))[0];
  if (!contact) throw new CrmNotFoundError('Contact');

  const [orgLinks, interactions, tasks, opportunities] = await Promise.all([
    db
      .select({ link: crmContactOrganizations, organization: crmOrganizations })
      .from(crmContactOrganizations)
      .innerJoin(crmOrganizations, eq(crmContactOrganizations.organizationId, crmOrganizations.id))
      .where(eq(crmContactOrganizations.contactId, id))
      .orderBy(desc(crmContactOrganizations.isPrimary)),
    db.select().from(crmInteractions).where(eq(crmInteractions.contactId, id)).orderBy(desc(crmInteractions.occurredAt)),
    db.select().from(crmTasks).where(eq(crmTasks.contactId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmOpportunities).where(eq(crmOpportunities.contactId, id)),
  ]);

  return {
    contact,
    organizations: orgLinks.map((r) => ({ ...r.organization, role: r.link.role, isPrimary: r.link.isPrimary })),
    interactions,
    tasks,
    opportunities,
  };
}

type OrgLink = { organizationId: string; role?: string; isPrimary: boolean };

/** Replace the full organization-link set for a contact, keeping `primary_organization_id` in sync. */
async function replaceOrganizationLinksTx(
  db: ReturnType<typeof getCrmDb>,
  contactId: string,
  links: OrgLink[],
): Promise<void> {
  const now = new Date().toISOString();
  await db.delete(crmContactOrganizations).where(eq(crmContactOrganizations.contactId, contactId));
  if (links.length > 0) {
    await db.insert(crmContactOrganizations).values(
      links.map((l) => ({
        id: randomUUID(),
        contactId,
        organizationId: l.organizationId,
        role: l.role ?? null,
        isPrimary: l.isPrimary,
        createdAt: now,
      })),
    );
  }
  const primary = links.find((l) => l.isPrimary)?.organizationId ?? null;
  await db
    .update(crmContacts)
    .set({ primaryOrganizationId: primary, updatedAt: now })
    .where(eq(crmContacts.id, contactId));
}

export async function replaceContactOrganizations(contactId: string, links: OrgLink[]): Promise<void> {
  const db = getCrmDb();
  const contact = (await db.select({ id: crmContacts.id }).from(crmContacts).where(eq(crmContacts.id, contactId)))[0];
  if (!contact) throw new CrmNotFoundError('Contact');
  await replaceOrganizationLinksTx(db, contactId, links);
}

export async function createContact(input: ContactInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmContacts).values({
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    position: input.position ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    whatsapp: input.whatsapp ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    city: input.city ?? null,
    language: input.language,
    status: input.status,
    source: input.source ?? null,
    ownerId: input.ownerId ?? null,
    notes: input.notes ?? null,
    platformUserId: input.platformUserId ?? null,
    platformMentorId: input.platformMentorId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  if (input.organizations && input.organizations.length > 0) {
    await replaceOrganizationLinksTx(db, id, input.organizations);
  }

  return getContactDetail(id);
}

export async function updateContact(id: string, input: Partial<ContactInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmContacts).where(eq(crmContacts.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Contact');

  const { organizations, ...fields } = input;
  if (Object.keys(fields).length > 0) {
    await db
      .update(crmContacts)
      .set({ ...fields, updatedAt: new Date().toISOString() })
      .where(eq(crmContacts.id, id));
  }
  if (organizations) {
    await replaceOrganizationLinksTx(db, id, organizations);
  }

  return getContactDetail(id);
}

export async function deleteContact(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select().from(crmContacts).where(eq(crmContacts.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Contact');

  const guard = await checkContactDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('ce contact', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmContacts).where(eq(crmContacts.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', "Impossible de supprimer ce contact — des éléments y sont encore rattachés.");
  }
}

export async function archiveContact(id: string) {
  await getCrmDb().update(crmContacts).set({ status: 'ARCHIVE', updatedAt: new Date().toISOString() }).where(eq(crmContacts.id, id));
  return getContactDetail(id);
}
