/**
 * METWORK OS CRM — Interactions service.
 *
 * Interactions are leaf rows (nothing references `crm_interactions.id`), so
 * delete never needs the orphan guard that Organizations/Contacts do.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmInteractions } from '../db/schema';
import type { InteractionInput } from '../validation/interactions';
import { CrmNotFoundError, CrmServiceError } from './errors';

export interface InteractionListFilters {
  contactId?: string;
  organizationId?: string;
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

/** For the Timeline component — every interaction for one Organization or Contact, chronological. */
export async function listTimeline(entity: { organizationId?: string; contactId?: string }) {
  const db = getCrmDb();
  const where = entity.organizationId
    ? eq(crmInteractions.organizationId, entity.organizationId)
    : entity.contactId
      ? eq(crmInteractions.contactId, entity.contactId)
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
    nextAction: input.nextAction ?? null,
    nextActionDate: input.nextActionDate ?? null,
    nextActionDone: input.nextActionDone,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0]!;
}

export async function updateInteraction(id: string, input: Record<string, unknown>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Interaction');

  // The "at least one link" invariant is checked against the MERGED row, not
  // the raw patch — see the note in validation/interactions.ts.
  const nextContactId = 'contactId' in input ? (input.contactId as string | null) : existing.contactId;
  const nextOrgId = 'organizationId' in input ? (input.organizationId as string | null) : existing.organizationId;
  if (!nextContactId && !nextOrgId) {
    throw new CrmServiceError(
      422,
      'CRM_VALIDATION_ERROR',
      'Rattachez cette interaction à un contact ou une organisation.',
    );
  }

  await db
    .update(crmInteractions)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(crmInteractions.id, id));

  return (await db.select().from(crmInteractions).where(eq(crmInteractions.id, id)))[0]!;
}

export async function deleteInteraction(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmInteractions.id }).from(crmInteractions).where(eq(crmInteractions.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Interaction');
  await db.delete(crmInteractions).where(eq(crmInteractions.id, id));
}
