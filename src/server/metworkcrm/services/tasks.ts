/**
 * METWORK OS CRM — Tasks service.
 *
 * Tasks are leaf rows (nothing references `crm_tasks.id`), so delete never
 * needs the orphan guard that Organizations/Contacts do.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmTasks } from '../db/schema';
import type { TaskInput } from '../validation/tasks';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { deleteDocumentLinksFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Mirrors LINK_COLUMNS in db/schema.ts plus booking_id/payment_id — the "no orphan task" invariant. */
const TASK_LINK_KEYS = [
  'contactId',
  'organizationId',
  'opportunityId',
  'startupId',
  'expertId',
  'partnershipId',
  'programId',
  'oiProjectId',
  'bookingId',
  'paymentId',
] as const;

export interface TaskListFilters {
  q?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  contactId?: string;
  organizationId?: string;
  opportunityId?: string;
  startupId?: string;
  expertId?: string;
  partnershipId?: string;
  programId?: string;
  oiProjectId?: string;
  bookingId?: string;
  paymentId?: string;
  limit: number;
  offset: number;
}

export async function listTasks(filters: TaskListFilters) {
  const db = getCrmDb();
  const clauses = [
    filters.status ? eq(crmTasks.status, filters.status as never) : undefined,
    filters.priority ? eq(crmTasks.priority, filters.priority as never) : undefined,
    filters.assigneeId ? eq(crmTasks.assigneeId, filters.assigneeId) : undefined,
    filters.contactId ? eq(crmTasks.contactId, filters.contactId) : undefined,
    filters.organizationId ? eq(crmTasks.organizationId, filters.organizationId) : undefined,
    filters.opportunityId ? eq(crmTasks.opportunityId, filters.opportunityId) : undefined,
    filters.startupId ? eq(crmTasks.startupId, filters.startupId) : undefined,
    filters.expertId ? eq(crmTasks.expertId, filters.expertId) : undefined,
    filters.partnershipId ? eq(crmTasks.partnershipId, filters.partnershipId) : undefined,
    filters.programId ? eq(crmTasks.programId, filters.programId) : undefined,
    filters.oiProjectId ? eq(crmTasks.oiProjectId, filters.oiProjectId) : undefined,
    filters.bookingId ? eq(crmTasks.bookingId, filters.bookingId) : undefined,
    filters.paymentId ? eq(crmTasks.paymentId, filters.paymentId) : undefined,
    filters.q ? sql`(${crmTasks.title} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmTasks)
      .where(where)
      // Open items first (by due date), completed ones trail by recency —
      // matches how a task list is actually scanned day to day.
      .orderBy(
        sql`CASE WHEN ${crmTasks.status} = 'TERMINEE' THEN 1 ELSE 0 END`,
        asc(crmTasks.dueDate),
        desc(crmTasks.createdAt),
      )
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmTasks).where(where),
  ]);
  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function createTask(input: TaskInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmTasks).values({
    id,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    status: input.status,
    dueDate: input.dueDate ?? null,
    dueAt: input.dueAt ?? null,
    assigneeId: input.assigneeId ?? null,
    contactId: input.contactId ?? null,
    organizationId: input.organizationId ?? null,
    opportunityId: input.opportunityId ?? null,
    startupId: input.startupId ?? null,
    expertId: input.expertId ?? null,
    partnershipId: input.partnershipId ?? null,
    programId: input.programId ?? null,
    oiProjectId: input.oiProjectId ?? null,
    bookingId: input.bookingId ?? null,
    paymentId: input.paymentId ?? null,
    source: 'MANUAL',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmTasks).where(eq(crmTasks.id, id)))[0]!;
}

export async function updateTask(id: string, input: Record<string, unknown>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmTasks).where(eq(crmTasks.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Tâche');

  // Merged-row check — see the note in validation/interactions.ts (same
  // pattern, same reason: zod always materializes optional keys).
  const mergedLink = (key: keyof typeof existing) =>
    key in input ? (input[key] as string | null) : (existing[key] as string | null);
  const hasAnyLink = TASK_LINK_KEYS.some((key) => mergedLink(key));
  if (!hasAnyLink) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez cette tâche à au moins un élément.');
  }

  const patch = { ...input, updatedAt: new Date().toISOString() } as Record<string, unknown>;
  if (input.status === 'TERMINEE' && existing.status !== 'TERMINEE') {
    patch.completedAt = new Date().toISOString();
  } else if (input.status && input.status !== 'TERMINEE') {
    patch.completedAt = null;
  }

  await db.update(crmTasks).set(patch).where(eq(crmTasks.id, id));
  return (await db.select().from(crmTasks).where(eq(crmTasks.id, id)))[0]!;
}

export async function deleteTask(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmTasks.id }).from(crmTasks).where(eq(crmTasks.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Tâche');
  await db.delete(crmTasks).where(eq(crmTasks.id, id));
  await deleteDocumentLinksFor('TASK', id);
}
