/**
 * METWORK OS CRM — Interactions service.
 *
 * Interactions are leaf rows (nothing references `crm_interactions.id`), so
 * delete never needs the orphan guard that Organizations/Contacts do.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmInteractions, crmOpportunities } from '../db/schema';
import type { InteractionInput } from '../validation/interactions';
import { CrmNotFoundError, CrmServiceError } from './errors';

/** Mirrors LINK_COLUMNS in db/schema.ts — the "no orphan interaction" invariant. */
const INTERACTION_LINK_KEYS = [
  'contactId',
  'organizationId',
  'opportunityId',
  'startupId',
  'expertId',
  'partnershipId',
  'programId',
  'oiProjectId',
] as const;

export interface InteractionListFilters {
  contactId?: string;
  organizationId?: string;
  opportunityId?: string;
  startupId?: string;
  expertId?: string;
  partnershipId?: string;
  programId?: string;
  oiProjectId?: string;
  type?: string;
  /** Only interactions with an unfinished next action due today or earlier. */
  nextActionDue?: boolean;
  limit: number;
  offset: number;
}

export async function listInteractions(filters: InteractionListFilters) {
  const db = getCrmDb();
  const today = new Date().toISOString().slice(0, 10);
  const clauses = [
    filters.contactId ? eq(crmInteractions.contactId, filters.contactId) : undefined,
    filters.organizationId ? eq(crmInteractions.organizationId, filters.organizationId) : undefined,
    filters.opportunityId ? eq(crmInteractions.opportunityId, filters.opportunityId) : undefined,
    filters.startupId ? eq(crmInteractions.startupId, filters.startupId) : undefined,
    filters.expertId ? eq(crmInteractions.expertId, filters.expertId) : undefined,
    filters.partnershipId ? eq(crmInteractions.partnershipId, filters.partnershipId) : undefined,
    filters.programId ? eq(crmInteractions.programId, filters.programId) : undefined,
    filters.oiProjectId ? eq(crmInteractions.oiProjectId, filters.oiProjectId) : undefined,
    filters.type ? eq(crmInteractions.type, filters.type as never) : undefined,
    filters.nextActionDue
      ? and(eq(crmInteractions.nextActionDone, false), lte(crmInteractions.nextActionDate, today))
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmInteractions)
      .where(where)
      .orderBy(desc(crmInteractions.occurredAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmInteractions).where(where),
  ]);
  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

/** For the Timeline component — every interaction for one entity, chronological. */
export async function listTimeline(entity: {
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  startupId?: string;
  expertId?: string;
  partnershipId?: string;
  programId?: string;
  oiProjectId?: string;
}) {
  const db = getCrmDb();
  const where = entity.organizationId
    ? eq(crmInteractions.organizationId, entity.organizationId)
    : entity.contactId
      ? eq(crmInteractions.contactId, entity.contactId)
      : entity.opportunityId
        ? eq(crmInteractions.opportunityId, entity.opportunityId)
        : entity.startupId
          ? eq(crmInteractions.startupId, entity.startupId)
          : entity.expertId
            ? eq(crmInteractions.expertId, entity.expertId)
            : entity.partnershipId
              ? eq(crmInteractions.partnershipId, entity.partnershipId)
              : entity.programId
                ? eq(crmInteractions.programId, entity.programId)
                : entity.oiProjectId
                  ? eq(crmInteractions.oiProjectId, entity.oiProjectId)
                  : undefined;
  if (!where) return [];
  return db.select().from(crmInteractions).where(where).orderBy(desc(crmInteractions.occurredAt));
}

export async function createInteraction(input: InteractionInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmInteractions).values({
    id,
    type: input.type,
    direction: input.direction,
    subject: input.subject,
    body: input.body ?? null,
    occurredAt: input.occurredAt,
    durationMinutes: input.durationMinutes,
    outcome: input.outcome ?? null,
    contactId: input.contactId ?? null,
    organizationId: input.organizationId ?? null,
    opportunityId: input.opportunityId ?? null,
    startupId: input.startupId ?? null,
    expertId: input.expertId ?? null,
    partnershipId: input.partnershipId ?? null,
    programId: input.programId ?? null,
    oiProjectId: input.oiProjectId ?? null,
    nextAction: input.nextAction ?? null,
    nextActionDate: input.nextActionDate ?? null,
    nextActionDone: input.nextActionDone,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  // Feeds `idx_crm_opp_stale` ("inactive 7+ days") — without this the index
  // never reflects real activity, since nothing else touches this column.
  if (input.opportunityId) {
    await db.update(crmOpportunities).set({ lastActivityAt: now }).where(eq(crmOpportunities.id, input.opportunityId));
  }

  return (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0]!;
}

export async function updateInteraction(id: string, input: Record<string, unknown>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Interaction');

  // The "at least one link" invariant is checked against the MERGED row, not
  // the raw patch — see the note in validation/interactions.ts.
  const mergedLink = (key: keyof typeof existing) =>
    key in input ? (input[key] as string | null) : (existing[key] as string | null);
  const hasAnyLink = INTERACTION_LINK_KEYS.some((key) => mergedLink(key));
  if (!hasAnyLink) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez cette interaction à au moins un élément.');
  }

  await db
    .update(crmInteractions)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(crmInteractions.id, id));

  const nextOpportunityId = mergedLink('opportunityId');
  if (nextOpportunityId) {
    await db
      .update(crmOpportunities)
      .set({ lastActivityAt: new Date().toISOString() })
      .where(eq(crmOpportunities.id, nextOpportunityId));
  }

  return (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0]!;
}

export async function deleteInteraction(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmInteractions.id }).from(crmInteractions).where(eq(crmInteractions.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Interaction');
  await db.delete(crmInteractions).where(eq(crmInteractions.id, id));
}
