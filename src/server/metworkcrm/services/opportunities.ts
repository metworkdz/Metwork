/**
 * METWORK OS CRM — Opportunities (Sales) service.
 *
 * Stage changes are written into `crm_opportunity_stage_history` (a Prompt 1
 * table that sat unused until now) so the pipeline has a real audit trail,
 * not just a current-value column. `amount`/`probability` money figures go
 * through `redactMoney` for TEAM_MEMBER (dev rules R-19).
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContacts,
  crmInteractions,
  crmOpportunities,
  crmOpportunityStageHistory,
  crmOrganizations,
  crmTasks,
} from '../db/schema';
import type { InternalUser } from '../db/schema';
import type { OpportunityInput } from '../validation/opportunities';
import { redactMoney } from '../auth/guards';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkOpportunityDeleteGuard, formatDeleteGuardMessage } from './delete-guard';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['amount'] as const;

export interface OpportunityListFilters {
  q?: string;
  type?: string;
  stage?: string;
  organizationId?: string;
  ownerId?: string;
  limit: number;
  offset: number;
}

export async function listOpportunities(filters: OpportunityListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.type ? eq(crmOpportunities.type, filters.type as never) : undefined,
    filters.stage ? eq(crmOpportunities.stage, filters.stage as never) : undefined,
    filters.organizationId ? eq(crmOpportunities.organizationId, filters.organizationId) : undefined,
    filters.ownerId ? eq(crmOpportunities.ownerId, filters.ownerId) : undefined,
    filters.q ? sql`(${crmOpportunities.title} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmOpportunities)
      .where(where)
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmOpportunities).where(where),
  ]);

  return {
    rows: rows.map((r) => redactMoney(user, r, MONEY_FIELDS)),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

export async function getOpportunityDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const opp = (await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)))[0];
  if (!opp) throw new CrmNotFoundError('Opportunité');

  const [organization, contact, tasks, interactions, stageHistory] = await Promise.all([
    opp.organizationId
      ? (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, opp.organizationId)))[0] ?? null
      : null,
    opp.contactId ? (await db.select().from(crmContacts).where(eq(crmContacts.id, opp.contactId)))[0] ?? null : null,
    db.select().from(crmTasks).where(eq(crmTasks.opportunityId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmInteractions).where(eq(crmInteractions.opportunityId, id)).orderBy(desc(crmInteractions.occurredAt)),
    db
      .select()
      .from(crmOpportunityStageHistory)
      .where(eq(crmOpportunityStageHistory.opportunityId, id))
      .orderBy(desc(crmOpportunityStageHistory.changedAt)),
  ]);

  return {
    opportunity: redactMoney(user, opp, MONEY_FIELDS),
    organization,
    contact,
    tasks,
    interactions,
    stageHistory,
  };
}

export async function createOpportunity(input: OpportunityInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmOpportunities).values({
    id,
    title: input.title,
    organizationId: input.organizationId ?? null,
    contactId: input.contactId ?? null,
    type: input.type,
    stage: input.stage,
    amount: input.amount,
    probability: input.probability,
    expectedCloseDate: input.expectedCloseDate ?? null,
    lostReason: input.lostReason ?? null,
    source: input.source ?? null,
    ownerId: input.ownerId ?? null,
    description: input.description ?? null,
    stageChangedAt: now,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  await db.insert(crmOpportunityStageHistory).values({
    id: randomUUID(),
    opportunityId: id,
    fromStage: null,
    toStage: input.stage,
    changedAt: now,
    changedBy: actorId,
  });

  return (await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)))[0]!;
}

export async function updateOpportunity(id: string, input: Partial<OpportunityInput>, actorId: string) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Opportunité');

  const mergedOrgId = 'organizationId' in input ? (input.organizationId ?? null) : existing.organizationId;
  const mergedContactId = 'contactId' in input ? (input.contactId ?? null) : existing.contactId;
  if (!mergedOrgId && !mergedContactId) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez cette opportunité à une organisation ou un contact.');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updatedAt: now };

  const stageChanged = input.stage && input.stage !== existing.stage;
  if (stageChanged) {
    patch.stageChangedAt = now;
    if ((input.stage === 'GAGNE' || input.stage === 'PERDU') && !existing.closedAt) {
      patch.closedAt = now;
    }
    await db.insert(crmOpportunityStageHistory).values({
      id: randomUUID(),
      opportunityId: id,
      fromStage: existing.stage,
      toStage: input.stage!,
      changedAt: now,
      changedBy: actorId,
    });
  }

  await db.update(crmOpportunities).set(patch).where(eq(crmOpportunities.id, id));
  return (await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)))[0]!;
}

export async function deleteOpportunity(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmOpportunities.id }).from(crmOpportunities).where(eq(crmOpportunities.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Opportunité');

  const guard = await checkOpportunityDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('cette opportunité', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmOpportunities).where(eq(crmOpportunities.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer cette opportunité — des éléments y sont encore rattachés.');
  }
}
