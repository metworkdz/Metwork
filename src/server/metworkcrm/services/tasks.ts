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

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface TaskListFilters {
  q?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  contactId?: string;
  organizationId?: string;
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
  const nextContactId = 'contactId' in input ? (input.contactId as string | null) : existing.contactId;
  const nextOrgId = 'organizationId' in input ? (input.organizationId as string | null) : existing.organizationId;
  if (!nextContactId && !nextOrgId) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez cette tâche à un contact ou une organisation.');
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
}
