/**
 * METWORK OS CRM — Open Innovation projects service.
 *
 * Mobilization (`crm_oi_startups`/`crm_oi_experts`) is managed as two small
 * junctions rather than a replace-wholesale set (unlike Partnerships'
 * contacts): a mobilized startup/expert carries its own `status` progression
 * (PRESSENTIE → MOBILISEE → RETENUE/ECARTEE) that a full-replace would lose.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContacts,
  crmExperts,
  crmOiExperts,
  crmOiProjects,
  crmOiStartups,
  crmOrganizations,
  crmPartnerships,
  crmStartups,
  crmTasks,
} from '../db/schema';
import type { InternalUser } from '../db/schema';
import type { OiProjectInput } from '../validation/oi-projects';
import { redactMoney } from '../auth/guards';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkOiProjectDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['budget'] as const;

export interface OiProjectListFilters {
  q?: string;
  stage?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}

export async function listOiProjects(filters: OiProjectListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.stage ? eq(crmOiProjects.stage, filters.stage as never) : undefined,
    filters.organizationId ? eq(crmOiProjects.organizationId, filters.organizationId) : undefined,
    filters.q ? sql`(${crmOiProjects.title} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmOiProjects)
      .where(where)
      .orderBy(desc(crmOiProjects.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmOiProjects).where(where),
  ]);

  return { rows: rows.map((r) => redactMoney(user, r, MONEY_FIELDS)), total: Number(totalRows[0]?.n ?? 0) };
}

export async function getOiProjectDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const project = (await db.select().from(crmOiProjects).where(eq(crmOiProjects.id, id)))[0];
  if (!project) throw new CrmNotFoundError('Projet Open Innovation');

  const [organization, contact, partnership, startups, experts, tasks, documents] = await Promise.all([
    project.organizationId
      ? (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, project.organizationId)))[0] ?? null
      : null,
    project.contactId ? (await db.select().from(crmContacts).where(eq(crmContacts.id, project.contactId)))[0] ?? null : null,
    project.partnershipId
      ? (await db.select().from(crmPartnerships).where(eq(crmPartnerships.id, project.partnershipId)))[0] ?? null
      : null,
    db
      .select({ link: crmOiStartups, startup: crmStartups })
      .from(crmOiStartups)
      .innerJoin(crmStartups, eq(crmOiStartups.startupId, crmStartups.id))
      .where(eq(crmOiStartups.oiProjectId, id))
      .orderBy(asc(crmOiStartups.createdAt)),
    db
      .select({ link: crmOiExperts, expert: crmExperts })
      .from(crmOiExperts)
      .innerJoin(crmExperts, eq(crmOiExperts.expertId, crmExperts.id))
      .where(eq(crmOiExperts.oiProjectId, id))
      .orderBy(asc(crmOiExperts.createdAt)),
    db.select().from(crmTasks).where(eq(crmTasks.oiProjectId, id)).orderBy(desc(crmTasks.createdAt)),
    listDocumentsFor('OI_PROJECT', id),
  ]);

  return {
    project: redactMoney(user, project, MONEY_FIELDS),
    organization,
    contact,
    partnership,
    startups: startups.map((r) => ({ ...r.startup, mobilizationId: r.link.id, role: r.link.role, status: r.link.status })),
    experts: experts.map((r) => ({ ...r.expert, mobilizationId: r.link.id, role: r.link.role, status: r.link.status })),
    tasks,
    documents,
  };
}

export async function createOiProject(input: OiProjectInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmOiProjects).values({
    id,
    title: input.title,
    organizationId: input.organizationId ?? null,
    contactId: input.contactId ?? null,
    partnershipId: input.partnershipId ?? null,
    stage: input.stage,
    stageChangedAt: now,
    problemStatement: input.problemStatement ?? null,
    challengeStatement: input.challengeStatement ?? null,
    budget: input.budget,
    currency: input.currency,
    startDate: input.startDate ?? null,
    targetEndDate: input.targetEndDate ?? null,
    ownerId: input.ownerId ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmOiProjects).where(eq(crmOiProjects.id, id)))[0]!;
}

export async function updateOiProject(id: string, input: Partial<OiProjectInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmOiProjects).where(eq(crmOiProjects.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Projet Open Innovation');

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updatedAt: now };
  if (input.stage && input.stage !== existing.stage) {
    patch.stageChangedAt = now;
  }

  await db.update(crmOiProjects).set(patch).where(eq(crmOiProjects.id, id));
  return (await db.select().from(crmOiProjects).where(eq(crmOiProjects.id, id)))[0]!;
}

export async function deleteOiProject(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmOiProjects.id }).from(crmOiProjects).where(eq(crmOiProjects.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Projet Open Innovation');

  const guard = await checkOiProjectDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('ce projet', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmOiProjects).where(eq(crmOiProjects.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer ce projet — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('OI_PROJECT', id);
}

/* ─────────────────────── Mobilization: startups ─────────────────────── */

export async function addOiStartup(oiProjectId: string, startupId: string, input: { role?: string; status: string }) {
  const db = getCrmDb();
  const existing = (
    await db
      .select({ id: crmOiStartups.id })
      .from(crmOiStartups)
      .where(and(eq(crmOiStartups.oiProjectId, oiProjectId), eq(crmOiStartups.startupId, startupId)))
  )[0];
  if (existing) throw new CrmServiceError(409, 'CRM_ALREADY_LINKED', 'Cette startup est déjà mobilisée sur ce projet.');

  await db.insert(crmOiStartups).values({
    id: randomUUID(),
    oiProjectId,
    startupId,
    role: input.role ?? null,
    status: input.status as never,
    createdAt: new Date().toISOString(),
  });
}

export async function updateOiStartup(mobilizationId: string, input: { role?: string; status?: string }) {
  const db = getCrmDb();
  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = input.role || null;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) return;
  await db.update(crmOiStartups).set(patch).where(eq(crmOiStartups.id, mobilizationId));
}

export async function removeOiStartup(mobilizationId: string): Promise<void> {
  await getCrmDb().delete(crmOiStartups).where(eq(crmOiStartups.id, mobilizationId));
}

/* ─────────────────────── Mobilization: experts ─────────────────────── */

export async function addOiExpert(oiProjectId: string, expertId: string, input: { role?: string; status: string }) {
  const db = getCrmDb();
  const existing = (
    await db
      .select({ id: crmOiExperts.id })
      .from(crmOiExperts)
      .where(and(eq(crmOiExperts.oiProjectId, oiProjectId), eq(crmOiExperts.expertId, expertId)))
  )[0];
  if (existing) throw new CrmServiceError(409, 'CRM_ALREADY_LINKED', 'Cet expert est déjà mobilisé sur ce projet.');

  await db.insert(crmOiExperts).values({
    id: randomUUID(),
    oiProjectId,
    expertId,
    role: input.role ?? null,
    status: input.status as never,
    createdAt: new Date().toISOString(),
  });
}

export async function updateOiExpert(mobilizationId: string, input: { role?: string; status?: string }) {
  const db = getCrmDb();
  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = input.role || null;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) return;
  await db.update(crmOiExperts).set(patch).where(eq(crmOiExperts.id, mobilizationId));
}

export async function removeOiExpert(mobilizationId: string): Promise<void> {
  await getCrmDb().delete(crmOiExperts).where(eq(crmOiExperts.id, mobilizationId));
}
