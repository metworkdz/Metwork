/**
 * METWORK OS CRM — Startups service.
 *
 * `platformListingId` is accepted end-to-end (matches the schema/product-spec
 * identity model — see validation/startups.ts) but no create/edit form field
 * exposes it, same as `platformIncubatorId` on Organizations: linking an
 * existing platform StartupListing is a separate "linking screen" feature,
 * not built in this pass. Every startup created through the UI is CRM_ONLY,
 * so `displayNameCache` stays NULL and search/display read `name` directly —
 * same non-authoritative-cache posture as Organizations.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContacts,
  crmExperts,
  crmInteractions,
  crmOrganizations,
  crmStartups,
  crmTasks,
} from '../db/schema';
import type { StartupInput } from '../validation/startups';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkStartupDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface StartupListFilters {
  q?: string;
  pipelineStage?: string;
  sector?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}

export async function listStartups(filters: StartupListFilters) {
  const db = getCrmDb();
  const clauses = [
    filters.pipelineStage ? eq(crmStartups.pipelineStage, filters.pipelineStage as never) : undefined,
    filters.sector ? sql`(${crmStartups.sector} LIKE ${likeTerm(filters.sector)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
    filters.organizationId ? eq(crmStartups.organizationId, filters.organizationId) : undefined,
    filters.q
      ? sql`(COALESCE(${crmStartups.displayNameCache}, ${crmStartups.name}) LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmStartups)
      .where(where)
      .orderBy(desc(crmStartups.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmStartups).where(where),
  ]);

  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function getStartupDetail(id: string) {
  const db = getCrmDb();
  const startup = (await db.select().from(crmStartups).where(eq(crmStartups.id, id)))[0];
  if (!startup) throw new CrmNotFoundError('Startup');

  const [organization, primaryContact, assignedExpert, tasks, interactions, documents] = await Promise.all([
    startup.organizationId
      ? (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, startup.organizationId)))[0] ?? null
      : null,
    startup.primaryContactId
      ? (await db.select().from(crmContacts).where(eq(crmContacts.id, startup.primaryContactId)))[0] ?? null
      : null,
    startup.assignedExpertId
      ? (await db.select().from(crmExperts).where(eq(crmExperts.id, startup.assignedExpertId)))[0] ?? null
      : null,
    db.select().from(crmTasks).where(eq(crmTasks.startupId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmInteractions).where(eq(crmInteractions.startupId, id)).orderBy(desc(crmInteractions.occurredAt)),
    listDocumentsFor('STARTUP', id),
  ]);

  return { startup, organization, primaryContact, assignedExpert, tasks, interactions, documents };
}

export async function createStartup(input: StartupInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmStartups).values({
    id,
    platformListingId: input.platformListingId ?? null,
    name: input.name ?? null,
    sector: input.sector ?? null,
    city: input.city ?? null,
    website: input.website ?? null,
    description: input.description ?? null,
    founderName: input.founderName ?? null,
    founderEmail: input.founderEmail ?? null,
    founderPhone: input.founderPhone ?? null,
    organizationId: input.organizationId ?? null,
    primaryContactId: input.primaryContactId ?? null,
    pipelineStage: input.pipelineStage,
    stageChangedAt: now,
    assignedExpertId: input.assignedExpertId ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmStartups).where(eq(crmStartups.id, id)))[0]!;
}

export async function updateStartup(id: string, input: Partial<StartupInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmStartups).where(eq(crmStartups.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Startup');

  const mergedListingId = 'platformListingId' in input ? (input.platformListingId ?? null) : existing.platformListingId;
  const mergedName = 'name' in input ? (input.name ?? null) : existing.name;
  if (!mergedListingId && !mergedName) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Indiquez un nom, ou liez cette fiche à une startup de la plateforme.');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updatedAt: now };
  if (input.pipelineStage && input.pipelineStage !== existing.pipelineStage) {
    patch.stageChangedAt = now;
  }

  await db.update(crmStartups).set(patch).where(eq(crmStartups.id, id));
  return (await db.select().from(crmStartups).where(eq(crmStartups.id, id)))[0]!;
}

export async function deleteStartup(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmStartups.id }).from(crmStartups).where(eq(crmStartups.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Startup');

  const guard = await checkStartupDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('cette startup', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmStartups).where(eq(crmStartups.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer cette startup — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('STARTUP', id);
}
