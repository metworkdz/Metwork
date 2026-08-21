/**
 * METWORK OS CRM — Opportunities service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunityDetail,
  listOpportunities,
  updateOpportunity,
} from '@/server/metworkcrm/services/opportunities';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { createInteraction } from '@/server/metworkcrm/services/interactions';
import { CrmServiceError, CrmNotFoundError } from '@/server/metworkcrm/services/errors';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ADMIN = 'test-admin';
const MEMBER = 'test-member';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ADMIN}, 'Admin', 'admin@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now}),
           (${MEMBER}, 'Membre', 'member@metwork.dz', 'x', 'TEAM_MEMBER', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_opportunity_stage_history`);
  await db.run(sql`DELETE FROM crm_opportunities`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Opportunities — CRUD', () => {
  it('creates an opportunity and its initial stage-history row', async () => {
    const org = await createOrganization({ name: 'Org A', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity(
      { title: 'Pack Coworking', organizationId: org.id, type: 'COWORKING', stage: 'NOUVEAU_LEAD' },
      ADMIN,
    );
    expect(opp.title).toBe('Pack Coworking');
    expect(opp.stage).toBe('NOUVEAU_LEAD');

    const detail = await getOpportunityDetail(opp.id, { role: 'ADMIN' });
    expect(detail.stageHistory).toHaveLength(1);
    expect(detail.stageHistory[0]!.fromStage).toBeNull();
    expect(detail.stageHistory[0]!.toStage).toBe('NOUVEAU_LEAD');
  });

  it('requires an organization or a contact', async () => {
    const org = await createOrganization({ name: 'Org B', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    // Zod's superRefine on the input schema is the primary guard; the service itself
    // is exercised directly here to prove it too refuses an unlinked opportunity.
    await expect(
      createOpportunity({ title: 'Orphan', type: 'AUTRE', stage: 'NOUVEAU_LEAD' } as never, ADMIN),
    ).rejects.toThrow();
    // sanity: a linked one succeeds
    await expect(
      createOpportunity({ title: 'Linked', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN),
    ).resolves.toBeTruthy();
  });

  it('appends stage history and bumps stageChangedAt on a stage change, not on other edits', async () => {
    const org = await createOrganization({ name: 'Org C', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'X', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN);

    await new Promise((r) => setTimeout(r, 2));
    const noStageChange = await updateOpportunity(opp.id, { description: 'updated' }, ADMIN);
    expect(noStageChange.stageChangedAt).toBe(opp.stageChangedAt);

    const stageChanged = await updateOpportunity(opp.id, { stage: 'CONTACTE' }, ADMIN);
    expect(stageChanged.stageChangedAt).not.toBe(opp.stageChangedAt);

    const detail = await getOpportunityDetail(opp.id, { role: 'ADMIN' });
    expect(detail.stageHistory).toHaveLength(2);
    expect(detail.stageHistory[0]!.toStage).toBe('CONTACTE');
    expect(detail.stageHistory[0]!.fromStage).toBe('NOUVEAU_LEAD');
  });

  it('stamps closedAt when moving into GAGNE or PERDU', async () => {
    const org = await createOrganization({ name: 'Org D', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Y', organizationId: org.id, type: 'AUTRE', stage: 'NEGOCIATION' }, ADMIN);
    const closed = await updateOpportunity(opp.id, { stage: 'GAGNE' }, ADMIN);
    expect(closed.closedAt).not.toBeNull();
  });

  it('throws CrmNotFoundError updating a missing opportunity', async () => {
    await expect(updateOpportunity('nope', { title: 'x' }, ADMIN)).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('Opportunities — money redaction (dev rules R-19)', () => {
  it('ADMIN sees the amount; TEAM_MEMBER does not', async () => {
    const org = await createOrganization({ name: 'Org E', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Z', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD', amount: 50000 }, ADMIN);

    const asAdmin = await getOpportunityDetail(opp.id, { role: 'ADMIN' });
    expect(asAdmin.opportunity.amount).toBe(50000);

    const asMember = await getOpportunityDetail(opp.id, { role: 'TEAM_MEMBER' });
    expect(asMember.opportunity.amount).toBeNull();

    const list = await listOpportunities({ limit: 50, offset: 0 }, { role: 'TEAM_MEMBER' });
    expect(list.rows[0]!.amount).toBeNull();
  });
});

describe('Opportunities — detail aggregation', () => {
  it('shows linked tasks and interactions', async () => {
    const org = await createOrganization({ name: 'Org F', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Detail', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN);
    await createTask({ title: 'Suivi', priority: 'HAUTE', status: 'A_FAIRE', opportunityId: opp.id } as never, ADMIN);
    await createInteraction(
      { type: 'APPEL', subject: 'Découverte', occurredAt: new Date().toISOString(), opportunityId: opp.id, nextActionDone: false } as never,
      ADMIN,
    );

    const detail = await getOpportunityDetail(opp.id, { role: 'ADMIN' });
    expect(detail.tasks).toHaveLength(1);
    expect(detail.interactions).toHaveLength(1);
    expect(detail.organization?.name).toBe('Org F');
  });

  it('touches the opportunity lastActivityAt when an interaction is logged against it', async () => {
    const org = await createOrganization({ name: 'Org G', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Activity', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN);
    const before = opp.lastActivityAt;

    await new Promise((r) => setTimeout(r, 2));
    await createInteraction(
      { type: 'APPEL', subject: 'Relance', occurredAt: new Date().toISOString(), opportunityId: opp.id, nextActionDone: false } as never,
      ADMIN,
    );

    const detail = await getOpportunityDetail(opp.id, { role: 'ADMIN' });
    expect(detail.opportunity.lastActivityAt).not.toBe(before);
  });
});

describe('Opportunities — delete guard', () => {
  it('blocks deleting an opportunity that is the sole link on a task', async () => {
    const org = await createOrganization({ name: 'Org H', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Blocked', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', opportunityId: opp.id } as never, ADMIN);

    let error: unknown;
    try {
      await deleteOpportunity(opp.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting an opportunity with no dependents', async () => {
    const org = await createOrganization({ name: 'Org I', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ADMIN);
    const opp = await createOpportunity({ title: 'Free', organizationId: org.id, type: 'AUTRE', stage: 'NOUVEAU_LEAD' }, ADMIN);
    await deleteOpportunity(opp.id);
    await expect(getOpportunityDetail(opp.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
