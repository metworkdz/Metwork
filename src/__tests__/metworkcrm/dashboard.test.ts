/**
 * METWORK OS CRM — Dashboard service (product spec §4.18, Prompt 6).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { getDashboardData } from '@/server/metworkcrm/services/dashboard';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { createInteraction } from '@/server/metworkcrm/services/interactions';
import { createOpportunity } from '@/server/metworkcrm/services/opportunities';
import { createPartnership } from '@/server/metworkcrm/services/partnerships';
import { createStartup } from '@/server/metworkcrm/services/startups';
import { createExpert } from '@/server/metworkcrm/services/experts';
import { createOiProject } from '@/server/metworkcrm/services/oi-projects';
import { createProgram } from '@/server/metworkcrm/services/programs';
import { createPayment } from '@/server/metworkcrm/services/payments';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ADMIN = 'test-admin';
const MEMBER = 'test-member';

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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
  await db.run(sql`DELETE FROM crm_payments`);
  await db.run(sql`DELETE FROM crm_partnerships`);
  await db.run(sql`DELETE FROM crm_startups`);
  await db.run(sql`DELETE FROM crm_experts`);
  await db.run(sql`DELETE FROM crm_oi_projects`);
  await db.run(sql`DELETE FROM crm_program_participants`);
  await db.run(sql`DELETE FROM crm_programs`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A', status: 'PROSPECT' | 'ACTIF' = 'ACTIF') {
  return createOrganization({ name, type: 'ENTREPRISE', status, country: 'DZ' }, ADMIN);
}

describe('Dashboard — Today (personal)', () => {
  it('shows a task due today assigned to the viewer, not one assigned to someone else', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Mine today', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(0), assigneeId: ADMIN, organizationId: org.id }, ADMIN);
    await createTask({ title: 'Theirs today', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(0), assigneeId: MEMBER, organizationId: org.id }, MEMBER);
    await createTask({ title: 'Mine tomorrow', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(1), assigneeId: ADMIN, organizationId: org.id }, ADMIN);

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.today.tasks.map((t) => t.title)).toEqual(['Mine today']);
  });

  it('shows a follow-up due today logged by the viewer', async () => {
    const org = await makeOrg();
    await createInteraction(
      { type: 'APPEL', subject: 'Call', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Relancer', nextActionDate: isoDate(0), nextActionDone: false },
      ADMIN,
    );
    await createInteraction(
      { type: 'APPEL', subject: 'Other', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Relancer', nextActionDate: isoDate(0), nextActionDone: false },
      MEMBER,
    );

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.today.followUps).toHaveLength(1);
    expect(data.today.followUps[0]!.title).toBe('Call');
    expect(data.today.followUps[0]!.subtitle).toBe('Org A');
  });
});

describe('Dashboard — Urgent (personal)', () => {
  it('lists overdue tasks assigned to the viewer', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Overdue mine', priority: 'HAUTE', status: 'A_FAIRE', dueDate: isoDate(-2), assigneeId: ADMIN, organizationId: org.id }, ADMIN);
    await createTask({ title: 'Overdue theirs', priority: 'HAUTE', status: 'A_FAIRE', dueDate: isoDate(-2), assigneeId: MEMBER, organizationId: org.id }, MEMBER);

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.urgent.overdueTasks.map((t) => t.title)).toEqual(['Overdue mine']);
  });

  it('lists an unfollowed PROSPECT but not an unfollowed ACTIF organization', async () => {
    const prospect = await makeOrg('Prospect Co', 'PROSPECT');
    const active = await makeOrg('Active Co', 'ACTIF');
    await createInteraction(
      { type: 'APPEL', subject: 'Prospect call', occurredAt: new Date().toISOString(), organizationId: prospect.id, nextActionDate: isoDate(-3), nextActionDone: false },
      ADMIN,
    );
    await createInteraction(
      { type: 'APPEL', subject: 'Active call', occurredAt: new Date().toISOString(), organizationId: active.id, nextActionDate: isoDate(-3), nextActionDone: false },
      ADMIN,
    );

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.urgent.unfollowedProspects.map((r) => r.title)).toEqual(['Prospect call']);
  });

  it('lists an opportunity stalled 7+ days, owned by the viewer, not a recently-changed one', async () => {
    const org = await makeOrg();
    const stale = await createOpportunity({ title: 'Stale deal', organizationId: org.id, type: 'CONSULTING', stage: 'CONTACTE', amount: 10000, probability: 50, ownerId: ADMIN }, ADMIN);
    const fresh = await createOpportunity({ title: 'Fresh deal', organizationId: org.id, type: 'CONSULTING', stage: 'CONTACTE', amount: 10000, probability: 50, ownerId: ADMIN }, ADMIN);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(sql`UPDATE crm_opportunities SET stage_changed_at = ${eightDaysAgo} WHERE id = ${stale.id}`);
    void fresh;

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.urgent.blockedOpportunities.map((r) => r.title)).toEqual(['Stale deal']);
  });

  it('shows the overdue payments count for ADMIN and hides it (null) for TEAM_MEMBER', async () => {
    const org = await makeOrg();
    await createPayment({ label: 'Facture', amount: 5000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', dueDate: isoDate(-5), organizationId: org.id }, ADMIN);

    const asAdmin = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    const asMember = await getDashboardData({ id: MEMBER, role: 'TEAM_MEMBER' });
    expect(asAdmin.urgent.overduePaymentsCount).toBe(1);
    expect(asMember.urgent.overduePaymentsCount).toBeNull();
  });
});

describe('Dashboard — Commercial (team-wide)', () => {
  it('buckets opportunities by stage and redacts pipeline value for TEAM_MEMBER', async () => {
    const org = await makeOrg();
    await createOpportunity({ title: 'Lead 1', organizationId: org.id, type: 'CONSULTING', stage: 'NOUVEAU_LEAD', amount: 10000, probability: 10 }, ADMIN);
    await createOpportunity({ title: 'Offer 1', organizationId: org.id, type: 'CONSULTING', stage: 'PROPOSITION_ENVOYEE', amount: 20000, probability: 40 }, ADMIN);
    await createOpportunity({ title: 'Won 1', organizationId: org.id, type: 'CONSULTING', stage: 'GAGNE', amount: 30000, probability: 100 }, ADMIN);

    const asAdmin = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(asAdmin.commercial.newLeads).toBe(1);
    expect(asAdmin.commercial.offers).toBe(1);
    expect(asAdmin.commercial.wonDeals).toBe(1);
    expect(asAdmin.commercial.pipelineValue).toBe(30000); // Lead + Offer, excludes Won

    const asMember = await getDashboardData({ id: MEMBER, role: 'TEAM_MEMBER' });
    expect(asMember.commercial.pipelineValue).toBeNull();
    expect(asMember.commercial.newLeads).toBe(1); // counts stay visible (R-19 extended)
  });
});

describe('Dashboard — Ecosystem / Open Innovation / Programs (team-wide)', () => {
  it('counts active partnerships, startups and experts', async () => {
    const org = await makeOrg();
    await createPartnership({ name: 'Partner A', organizationId: org.id, type: 'CORPORATE', stage: 'ACTIF' }, ADMIN);
    await createStartup({ name: 'Startup A', pipelineStage: 'LEAD' }, ADMIN);
    await createExpert({ name: 'Expert A', pipelineStage: 'PROSPECT' }, ADMIN);

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.ecosystem.activePartnerships).toBe(1);
    expect(data.ecosystem.newPartners).toBe(1); // just created, within the 30-day window
    expect(data.ecosystem.startups).toBe(1);
    expect(data.ecosystem.experts).toBe(1);
  });

  it('counts Open Innovation POCs and active projects', async () => {
    const org = await makeOrg();
    await createOiProject({ title: 'Project A', organizationId: org.id, stage: 'POC', challengeStatement: 'Un défi', currency: 'DZD' }, ADMIN);
    await createOiProject({ title: 'Project B (done)', organizationId: org.id, stage: 'TERMINE', currency: 'DZD' }, ADMIN);

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.openInnovation.pocs).toBe(1);
    expect(data.openInnovation.challenges).toBe(1);
    expect(data.openInnovation.activeProjects).toBe(1); // TERMINE excluded
    expect(data.openInnovation.interestedCompanies).toBe(1);
  });

  it('lists upcoming programs, not past ones', async () => {
    await createProgram({ title: 'Future bootcamp', type: 'BOOTCAMP', stage: 'IDEE', startDate: isoDate(5) }, ADMIN);
    await createProgram({ title: 'Past bootcamp', type: 'BOOTCAMP', stage: 'IDEE', startDate: isoDate(-5) }, ADMIN);

    const data = await getDashboardData({ id: ADMIN, role: 'ADMIN' });
    expect(data.programs.upcoming.map((p) => p.title)).toEqual(['Future bootcamp']);
  });
});
