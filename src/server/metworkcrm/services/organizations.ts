/**
 * METWORK OS CRM — Organizations service.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContactOrganizations,
  crmContacts,
  crmInteractions,
  crmOpportunities,
  crmOrganizations,
  crmTasks,
} from '../db/schema';
import type { OrganizationInput } from '../validation/organizations';
import { CrmNotFoundError, CrmServiceError } from './errors';
import {
  checkOrganizationDeleteGuard,
  formatDeleteGuardMessage,
} from './delete-guard';

/** Escape SQLite LIKE wildcards so a literal `%`/`_` in a search term isn't treated as one. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface OrganizationListFilters {
  q?: string;
  type?: string;
  sector?: string;
  city?: string;
  status?: string;
  limit: number;
  offset: number;
}

export async function listOrganizations(filters: OrganizationListFilters) {
  const db = getCrmDb();
  const clauses = [
    filters.type ? eq(crmOrganizations.type, filters.type as never) : undefined,
    // Partial, case-insensitive — a free-text filter box that only matches an
    // exact stored value ("Oran" vs "oran ") is a usability trap, not a filter.
    filters.sector
      ? sql`(${crmOrganizations.sector} LIKE ${likeTerm(filters.sector)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
    filters.city
      ? sql`(${crmOrganizations.city} LIKE ${likeTerm(filters.city)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
    filters.status ? eq(crmOrganizations.status, filters.status as never) : undefined,
    filters.q
      ? sql`(${crmOrganizations.name} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmOrganizations)
      .where(where)
      .orderBy(desc(crmOrganizations.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: count() }).from(crmOrganizations).where(where),
  ]);

  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function getOrganizationDetail(id: string) {
  const db = getCrmDb();
  const org = (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, id)))[0];
  if (!org) throw new CrmNotFoundError('Organisation');

  const [contactLinks, interactions, tasks, opportunities] = await Promise.all([
    db
      .select({
        link: crmContactOrganizations,
        contact: crmContacts,
      })
      .from(crmContactOrganizations)
      .innerJoin(crmContacts, eq(crmContactOrganizations.contactId, crmContacts.id))
      .where(eq(crmContactOrganizations.organizationId, id))
      .orderBy(desc(crmContactOrganizations.isPrimary), asc(crmContacts.fullName)),
    db
      .select()
      .from(crmInteractions)
      .where(eq(crmInteractions.organizationId, id))
      .orderBy(desc(crmInteractions.occurredAt)),
    db
      .select()
      .from(crmTasks)
      .where(eq(crmTasks.organizationId, id))
      .orderBy(desc(crmTasks.createdAt)),
    // Opportunities module ships in Prompt 3 — this always returns [] until
    // then, which is the correct, forward-compatible behaviour (no schema
    // change needed later to show them here).
    db.select().from(crmOpportunities).where(eq(crmOpportunities.organizationId, id)),
  ]);

  return {
    organization: org,
    contacts: contactLinks.map((r) => ({ ...r.contact, role: r.link.role, isPrimary: r.link.isPrimary })),
    interactions,
    tasks,
    opportunities,
  };
}

export async function createOrganization(input: OrganizationInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmOrganizations).values({
    id,
    name: input.name,
    legalName: input.legalName ?? null,
    type: input.type,
    sector: input.sector ?? null,
    size: input.size,
    city: input.city ?? null,
    wilaya: input.wilaya ?? null,
    country: input.country,
    website: input.website ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    description: input.description ?? null,
    status: input.status,
    source: input.source ?? null,
    ownerId: input.ownerId ?? null,
    notes: input.notes ?? null,
    platformIncubatorId: input.platformIncubatorId ?? null,
    platformUserId: input.platformUserId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, id)))[0]!;
}

export async function updateOrganization(id: string, input: Partial<OrganizationInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Organisation');

  await db
    .update(crmOrganizations)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(crmOrganizations.id, id));

  return (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, id)))[0]!;
}

/** Hard delete, guarded (see delete-guard.ts). */
export async function deleteOrganization(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Organisation');

  const guard = await checkOrganizationDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('cette organisation', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmOrganizations).where(eq(crmOrganizations.id, id));
  } catch {
    // Defense in depth: the pre-check above should have caught every case,
    // but if a race or an un-anticipated FK still trips the CHECK, surface a
    // clean 409 instead of a raw SQLite error.
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', "Impossible de supprimer cette organisation — des éléments y sont encore rattachés.");
  }
}

export async function archiveOrganization(id: string) {
  return updateOrganization(id, { status: 'ARCHIVE' });
}
