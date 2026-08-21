/**
 * METWORK OS CRM — Automations (product spec §4.17, dev rules R-22/R-23).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { crmAutomationRuns, crmTasks } from '@/server/metworkcrm/db/schema';
import { runPaymentOverdueAutomation, runProposalFollowupAutomation } from '@/server/metworkcrm/services/automations';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createOpportunity, updateOpportunity } from '@/server/metworkcrm/services/opportunities';
import { createStartup, updateStartup } from '@/server/metworkcrm/services/startups';
import { createProgram } from '@/server/metworkcrm/services/programs';
import { createPayment } from '@/server/metworkcrm/services/payments';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ADMIN = 'test-admin';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ADMIN}, 'Admin', 'admin@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_automation_runs`);
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_payments`);
  await db.run(sql`DELETE FROM crm_opportunity_stage_history`);
  await db.run(sql`DELETE FROM crm_opportunities`);
  await db.run(sql`DELETE FROM crm_startups`);
  await db.run(sql`DELETE FROM crm_programs`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ADMIN);
}

describe('Automations — Opportunity → PROPOSITION_ENVOYEE', () => {
  it('creates a "Relance dans 3 jours" task due 3 days out, assigned to the owner', async () => {
    const org = await makeOrg();
    const opp = await createOpportunity(
      { title: 'Deal A', organizationId: org.id, type: 'CONSULTING', stage: 'CONTACTE', ownerId: ADMIN },
      ADMIN,
    );
    const updated = await updateOpportunity(opp.id, { stage: 'PROPOSITION_ENVOYEE' }, ADMIN);

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.opportunityId, opp.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toContain('Relance dans 3 jours');
    expect(tasks[0]!.source).toBe('AUTOMATION');
    expect(tasks[0]!.assigneeId).toBe(ADMIN);
    expect(tasks[0]!.organizationId).toBe(org.id);

    const expected = new Date(new Date(updated.stageChangedAt).getTime() + 3 * 86400000).toISOString().slice(0, 10);
    expect(tasks[0]!.dueDate).toBe(expected);
  });

  it('does not fire on other stage transitions, and does not duplicate on a re-run with the same transition timestamp', async () => {
    const org = await makeOrg();
    const opp = await createOpportunity(
      { title: 'Deal B', organizationId: org.id, type: 'CONSULTING', stage: 'CONTACTE', ownerId: ADMIN },
      ADMIN,
    );
    await updateOpportunity(opp.id, { stage: 'NEGOCIATION' }, ADMIN);
    let tasks = await db.select().from(crmTasks).where(eq(crmTasks.opportunityId, opp.id));
    expect(tasks).toHaveLength(0);

    const stageChangedAt = new Date().toISOString();
    await runProposalFollowupAutomation({
      id: opp.id, title: 'Deal B', organizationId: org.id, contactId: null, ownerId: ADMIN, stageChangedAt,
    });
    await runProposalFollowupAutomation({
      id: opp.id, title: 'Deal B', organizationId: org.id, contactId: null, ownerId: ADMIN, stageChangedAt,
    });
    tasks = await db.select().from(crmTasks).where(eq(crmTasks.opportunityId, opp.id));
    expect(tasks).toHaveLength(1);

    const runs = await db.select().from(crmAutomationRuns).where(eq(crmAutomationRuns.triggerEntityId, opp.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('OK');
  });
});

describe('Automations — Payment overdue', () => {
  it('creates one "Relance paiement" task and never duplicates it on a re-run', async () => {
    const org = await makeOrg();
    const payment = await createPayment(
      { label: 'Facture 42', amount: 5000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ADMIN,
    );
    await runPaymentOverdueAutomation({ id: payment.id, label: 'Facture 42', organizationId: org.id, contactId: null });
    await runPaymentOverdueAutomation({ id: payment.id, label: 'Facture 42', organizationId: org.id, contactId: null });

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.paymentId, payment.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toContain('Relance paiement');
    expect(tasks[0]!.priority).toBe('URGENTE');
  });
});

describe('Automations — Startup → ONBOARDING', () => {
  it('creates the 5-item onboarding task set, all linked to the startup', async () => {
    const org = await makeOrg();
    const startup = await createStartup({ name: 'Startup A', pipelineStage: 'BESOINS_IDENTIFIES', organizationId: org.id }, ADMIN);
    await updateStartup(startup.id, { pipelineStage: 'ONBOARDING' });

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.startupId, startup.id));
    expect(tasks).toHaveLength(5);
    expect(tasks.every((t) => t.source === 'AUTOMATION')).toBe(true);
    expect(tasks.every((t) => t.organizationId === org.id)).toBe(true);
  });

  it('does not fire on a transition into any other stage', async () => {
    const startup = await createStartup({ name: 'Startup B', pipelineStage: 'LEAD' }, ADMIN);
    await updateStartup(startup.id, { pipelineStage: 'DIAGNOSTIC' });

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.startupId, startup.id));
    expect(tasks).toHaveLength(0);
  });
});

describe('Automations — Program created', () => {
  it('creates the 10-item standard checklist', async () => {
    const program = await createProgram({ title: 'Bootcamp A', type: 'BOOTCAMP', stage: 'IDEE' }, ADMIN);

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.programId, program.id));
    expect(tasks).toHaveLength(10);
    const titles = tasks.map((t) => t.title);
    for (const item of ['Formateur', 'Salle', 'Visuel', 'Communication', 'Inscriptions', 'Paiement', 'Supports', 'Certificats', 'Feedback', 'Reporting']) {
      expect(titles.some((t) => t.startsWith(item))).toBe(true);
    }
  });
});

describe('Automations — non-blocking failure handling (R-22)', () => {
  it('logs ERREUR and does not throw when the task insert fails (bad FK reference)', async () => {
    await expect(
      runProposalFollowupAutomation({
        id: 'opp-x',
        title: 'Deal X',
        organizationId: 'does-not-exist',
        contactId: null,
        ownerId: null,
        stageChangedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    const runs = await db.select().from(crmAutomationRuns).where(eq(crmAutomationRuns.triggerEntityId, 'opp-x'));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('ERREUR');
    expect(runs[0]!.error).toBeTruthy();

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.opportunityId, 'opp-x'));
    expect(tasks).toHaveLength(0);
  });
});
