/**
 * METWORK OS CRM — Reports service (product spec §4.18, Prompt 6).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 * All-time snapshots (owner decision) — no period param to test here.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { getReportsData } from '@/server/metworkcrm/services/reports';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask, updateTask } from '@/server/metworkcrm/services/tasks';
import { createOpportunity } from '@/server/metworkcrm/services/opportunities';
import { createPartnership } from '@/server/metworkcrm/services/partnerships';
import { createStartup } from '@/server/metworkcrm/services/startups';
import { createExpert } from '@/server/metworkcrm/services/experts';
import { createOiProject } from '@/server/metworkcrm/services/oi-projects';
import { createProgram, addParticipant } from '@/server/metworkcrm/services/programs';

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
  await db.run(sql`DELETE FROM crm_opportunity_stage_history`);
  await db.run(sql`DELETE FROM crm_opportunities`);
  await db.run(sql`DELETE FROM crm_partnerships`);
  await db.run(sql`DELETE FROM crm_startups`);
  await db.run(sql`DELETE FROM crm_experts`);
  await db.run(sql`DELETE FROM crm_oi_startups`);
  await db.run(sql`DELETE FROM crm_oi_experts`);
  await db.run(sql`DELETE FROM crm_oi_projects`);
  await db.run(sql`DELETE FROM crm_program_participants`);
  await db.run(sql`DELETE FROM crm_programs`);
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ADMIN);
}

describe('Reports — Sales', () => {
  it('computes leads/conversion/pipeline and redacts money for TEAM_MEMBER', async () => {
    const org = await makeOrg();
    await createOpportunity({ title: 'Won', organizationId: org.id, type: 'CONSULTING', stage: 'GAGNE', amount: 10000 }, ADMIN);
    await createOpportunity({ title: 'Lost', organizationId: org.id, type: 'CONSULTING', stage: 'PERDU', amount: 5000 }, ADMIN);
    await createOpportunity({ title: 'Open', organizationId: org.id, type: 'FORMATION', stage: 'NEGOCIATION', amount: 7000 }, ADMIN);

    const asAdmin = await getReportsData({ role: 'ADMIN' });
    expect(asAdmin.sales.leads).toBe(3);
    expect(asAdmin.sales.won).toBe(1);
    expect(asAdmin.sales.lost).toBe(1);
    expect(asAdmin.sales.conversionRate).toBe(0.5);
    expect(asAdmin.sales.pipelineValue).toBe(7000);
    expect(asAdmin.sales.revenueByType).toEqual([{ type: 'CONSULTING', total: 10000 }]);

    const asMember = await getReportsData({ role: 'TEAM_MEMBER' });
    expect(asMember.sales.pipelineValue).toBeNull();
    expect(asMember.sales.revenueByType).toBeNull();
    expect(asMember.sales.leads).toBe(3); // non-monetary counts stay visible
  });
});

describe('Reports — Operations', () => {
  it('counts overdue tasks and computes average processing time for tasks completed this month', async () => {
    const org = await makeOrg();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await createTask({ title: 'Overdue', priority: 'HAUTE', status: 'A_FAIRE', dueDate: yesterday, organizationId: org.id }, ADMIN);

    const done = await createTask({ title: 'Done', priority: 'MOYENNE', status: 'A_FAIRE', organizationId: org.id }, ADMIN);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(sql`UPDATE crm_tasks SET created_at = ${twoDaysAgo} WHERE id = ${done.id}`);
    await updateTask(done.id, { status: 'TERMINEE', organizationId: org.id });

    const data = await getReportsData({ role: 'ADMIN' });
    expect(data.operations.tasksOverdue).toBe(1);
    expect(data.operations.tasksDoneThisMonth).toBe(1);
    expect(data.operations.avgProcessingDays).not.toBeNull();
    expect(data.operations.avgProcessingDays!).toBeGreaterThan(1.5);
  });
});

describe('Reports — Startups', () => {
  it('groups by sector and pipeline stage, and counts program-linked startups', async () => {
    const program = await createProgram({ title: 'Accel A', type: 'ACCELERATION', stage: 'IDEE' }, ADMIN);
    const startupA = await createStartup({ name: 'Startup A', sector: 'Fintech', pipelineStage: 'LEAD' }, ADMIN);
    // `programId` isn't exposed on the Startups create form (Prompt 3) — set the
    // column directly to exercise the report's `withProgram` aggregate.
    await db.run(sql`UPDATE crm_startups SET program_id = ${program.id} WHERE id = ${startupA.id}`);
    await createStartup({ name: 'Startup B', sector: 'Fintech', pipelineStage: 'ACTIF' }, ADMIN);

    const data = await getReportsData({ role: 'ADMIN' });
    expect(data.startups.total).toBe(2);
    expect(data.startups.bySector).toEqual([{ sector: 'Fintech', n: 2 }]);
    expect(data.startups.withProgram).toBe(1);
    expect(data.startups.byStage.find((s) => s.stage === 'LEAD')?.n).toBe(1);
    expect(data.startups.byStage.find((s) => s.stage === 'ACTIF')?.n).toBe(1);
  });
});

describe('Reports — Ecosystem / Open Innovation / Programs', () => {
  it('counts ecosystem totals', async () => {
    const org = await makeOrg();
    await createPartnership({ name: 'Partner A', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT' }, ADMIN);
    await createExpert({ name: 'Expert A', pipelineStage: 'PROSPECT' }, ADMIN);

    const data = await getReportsData({ role: 'ADMIN' });
    expect(data.ecosystem.partners).toBe(1);
    expect(data.ecosystem.experts).toBe(1);
    expect(data.ecosystem.organizations).toBe(1);
  });

  it('redacts Open Innovation budget for TEAM_MEMBER but keeps stage distribution visible', async () => {
    const org = await makeOrg();
    await createOiProject({ title: 'Project A', organizationId: org.id, stage: 'POC', budget: 50000, currency: 'DZD' }, ADMIN);

    const asAdmin = await getReportsData({ role: 'ADMIN' });
    expect(asAdmin.openInnovation.total).toBe(1);
    expect(asAdmin.openInnovation.budgetTotal).toBe(50000);
    expect(asAdmin.openInnovation.byStage).toEqual([{ stage: 'POC', n: 1 }]);

    const asMember = await getReportsData({ role: 'TEAM_MEMBER' });
    expect(asMember.openInnovation.budgetTotal).toBeNull();
    expect(asMember.openInnovation.total).toBe(1);
  });

  it('computes program fill rate, attendance and redacts revenue for TEAM_MEMBER', async () => {
    const program = await createProgram({ title: 'Bootcamp A', type: 'BOOTCAMP', stage: 'IDEE', capacity: 10, price: 2000 }, ADMIN);
    await addParticipant(program.id, { fullName: 'Walk-in A', status: 'PRESENT', attended: true, satisfactionScore: 4 }, ADMIN);
    await addParticipant(program.id, { fullName: 'Walk-in B', status: 'INSCRIT', attended: false }, ADMIN);

    const asAdmin = await getReportsData({ role: 'ADMIN' });
    expect(asAdmin.programs.fillRate).toBe(2 / 10);
    expect(asAdmin.programs.attendanceRate).toBe(1 / 2);
    expect(asAdmin.programs.revenue).toBe(2000); // only the PRESENT participant counts
    expect(asAdmin.programs.avgSatisfaction).toBe(4);

    const asMember = await getReportsData({ role: 'TEAM_MEMBER' });
    expect(asMember.programs.revenue).toBeNull();
    expect(asMember.programs.fillRate).toBe(2 / 10); // non-monetary, stays visible
  });
});
