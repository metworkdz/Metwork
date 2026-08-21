/**
 * METWORK OS CRM — Experts service. Same identity/link-status posture as
 * Startups (see the note there) — `platformMentorId` accepted end-to-end but
 * not exposed in the create/edit form; every UI-created expert is CRM_ONLY.
 *
 * `specialties` is a JSON string column; this service is the ONLY place that
 * serializes/deserializes it, so callers always see a plain string array.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmContacts, crmExperts, crmInteractions, crmOrganizations, crmTasks } from '../db/schema';
import type { ExpertInput } from '../validation/experts';
import { redactMoney } from '../auth/guards';
import type { InternalUser } from '../db/schema';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkExpertDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['dailyRate'] as const;

function withParsedSpecialties<T extends { specialties: string | null }>(row: T) {
  let specialties: string[] = [];
  if (row.specialties) {
    try {
      specialties = JSON.parse(row.specialties);
    } catch {
      specialties = [];
    }
  }
  return { ...row, specialties };
}

export interface ExpertListFilters {
  q?: string;
  pipelineStage?: string;
  limit: number;
  offset: number;
}

export async function listExperts(filters: ExpertListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.pipelineStage ? eq(crmExperts.pipelineStage, filters.pipelineStage as never) : undefined,
    filters.q
      ? sql`(COALESCE(${crmExperts.displayNameCache}, ${crmExperts.name}) LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmExperts)
      .where(where)
      .orderBy(desc(crmExperts.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmExperts).where(where),
  ]);

  return {
    rows: rows.map((r) => redactMoney(user, withParsedSpecialties(r), MONEY_FIELDS)),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

export async function getExpertDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const expert = (await db.select().from(crmExperts).where(eq(crmExperts.id, id)))[0];
  if (!expert) throw new CrmNotFoundError('Expert');

  const [organization, contact, tasks, interactions, documents] = await Promise.all([
    expert.organizationId
      ? (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, expert.organizationId)))[0] ?? null
      : null,
    expert.contactId ? (await db.select().from(crmContacts).where(eq(crmContacts.id, expert.contactId)))[0] ?? null : null,
    db.select().from(crmTasks).where(eq(crmTasks.expertId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmInteractions).where(eq(crmInteractions.expertId, id)).orderBy(desc(crmInteractions.occurredAt)),
    listDocumentsFor('EXPERT', id),
  ]);

  return {
    expert: redactMoney(user, withParsedSpecialties(expert), MONEY_FIELDS),
    organization,
    contact,
    documents,
    tasks,
    interactions,
  };
}

export async function createExpert(input: ExpertInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmExperts).values({
    id,
    platformMentorId: input.platformMentorId ?? null,
    name: input.name ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    city: input.city ?? null,
    specialties: input.specialties && input.specialties.length > 0 ? JSON.stringify(input.specialties) : null,
    pipelineStage: input.pipelineStage,
    stageChangedAt: now,
    dailyRate: input.dailyRate,
    organizationId: input.organizationId ?? null,
    contactId: input.contactId ?? null,
    internalNotes: input.internalNotes ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return withParsedSpecialties((await db.select().from(crmExperts).where(eq(crmExperts.id, id)))[0]!);
}

export async function updateExpert(id: string, input: Partial<ExpertInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmExperts).where(eq(crmExperts.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Expert');

  const mergedMentorId = 'platformMentorId' in input ? (input.platformMentorId ?? null) : existing.platformMentorId;
  const mergedName = 'name' in input ? (input.name ?? null) : existing.name;
  if (!mergedMentorId && !mergedName) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Indiquez un nom, ou liez cette fiche à un mentor de la plateforme.');
  }

  const now = new Date().toISOString();
  const { specialties, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest, updatedAt: now };
  if (specialties !== undefined) {
    patch.specialties = specialties.length > 0 ? JSON.stringify(specialties) : null;
  }
  if (input.pipelineStage && input.pipelineStage !== existing.pipelineStage) {
    patch.stageChangedAt = now;
  }

  await db.update(crmExperts).set(patch).where(eq(crmExperts.id, id));
  return withParsedSpecialties((await db.select().from(crmExperts).where(eq(crmExperts.id, id)))[0]!);
}

export async function deleteExpert(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmExperts.id }).from(crmExperts).where(eq(crmExperts.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Expert');

  const guard = await checkExpertDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('cet expert', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmExperts).where(eq(crmExperts.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer cet expert — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('EXPERT', id);
}
