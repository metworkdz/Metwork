/**
 * METWORK OS CRM — Open Innovation projects service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  addOiExpert,
  addOiStartup,
  createOiProject,
  deleteOiProject,
  getOiProjectDetail,
  listOiProjects,
  removeOiStartup,
  updateOiProject,
  updateOiStartup,
} from '@/server/metworkcrm/services/oi-projects';
import { createStartup } from '@/server/metworkcrm/services/startups';
import { createExpert } from '@/server/metworkcrm/services/experts';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { CrmServiceError, CrmNotFoundError } from '@/server/metworkcrm/services/errors';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ACTOR = 'test-actor';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ACTOR}, 'Test Actor', 'actor@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_payments`);
  await db.run(sql`DELETE FROM crm_oi_startups`);
  await db.run(sql`DELETE FROM crm_oi_experts`);
  await db.run(sql`DELETE FROM crm_oi_projects`);
  await db.run(sql`DELETE FROM crm_startups`);
  await db.run(sql`DELETE FROM crm_experts`);
});

describe('OI Projects — CRUD', () => {
  it('creates a project with no link required (unlike Opportunities/Partnerships)', async () => {
    const project = await createOiProject({ title: 'Défi logistique', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    expect(project.title).toBe('Défi logistique');
    expect(project.organizationId).toBeNull();
  });

  it('bumps stageChangedAt only when stage actually changes', async () => {
    const project = await createOiProject({ title: 'X', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const same = await updateOiProject(project.id, { budget: 100000 });
    expect(same.stageChangedAt).toBe(project.stageChangedAt);

    const changed = await updateOiProject(project.id, { stage: 'DIAGNOSTIC' });
    expect(changed.stageChangedAt).not.toBe(project.stageChangedAt);
  });

  it('throws CrmNotFoundError updating a missing project', async () => {
    await expect(updateOiProject('nope', { title: 'x' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by stage and searches by title', async () => {
    await createOiProject({ title: 'Alpha Challenge', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    await createOiProject({ title: 'Beta Challenge', stage: 'POC', currency: 'DZD' }, ACTOR);

    const byStage = await listOiProjects({ stage: 'POC', limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byStage.rows.map((r) => r.title)).toEqual(['Beta Challenge']);

    const byQuery = await listOiProjects({ q: 'alpha', limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byQuery.rows.map((r) => r.title)).toEqual(['Alpha Challenge']);
  });
});

describe('OI Projects — money redaction (dev rules R-19)', () => {
  it('ADMIN sees the budget; TEAM_MEMBER does not', async () => {
    const project = await createOiProject({ title: 'Budget test', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD', budget: 500000 }, ACTOR);

    const asAdmin = await getOiProjectDetail(project.id, { role: 'ADMIN' });
    expect(asAdmin.project.budget).toBe(500000);

    const asMember = await getOiProjectDetail(project.id, { role: 'TEAM_MEMBER' });
    expect(asMember.project.budget).toBeNull();
  });
});

describe('OI Projects — mobilization', () => {
  it('mobilizes a startup and an expert, tracks status, and prevents double-mobilization', async () => {
    const project = await createOiProject({ title: 'Mobilize test', stage: 'RECHERCHE_SOLUTION', currency: 'DZD' }, ACTOR);
    const startup = await createStartup({ name: 'Startup A', pipelineStage: 'LEAD' }, ACTOR);
    const expert = await createExpert({ name: 'Expert A', pipelineStage: 'ACTIF' }, ACTOR);

    await addOiStartup(project.id, startup.id, { status: 'PRESSENTIE' });
    await addOiExpert(project.id, expert.id, { status: 'PRESSENTIE' });

    await expect(addOiStartup(project.id, startup.id, { status: 'PRESSENTIE' })).rejects.toBeInstanceOf(CrmServiceError);

    let detail = await getOiProjectDetail(project.id, { role: 'ADMIN' });
    expect(detail.startups).toHaveLength(1);
    expect(detail.startups[0]!.status).toBe('PRESSENTIE');
    expect(detail.experts).toHaveLength(1);

    await updateOiStartup(detail.startups[0]!.mobilizationId, { status: 'RETENUE' });
    detail = await getOiProjectDetail(project.id, { role: 'ADMIN' });
    expect(detail.startups[0]!.status).toBe('RETENUE');

    await removeOiStartup(detail.startups[0]!.mobilizationId);
    detail = await getOiProjectDetail(project.id, { role: 'ADMIN' });
    expect(detail.startups).toHaveLength(0);
  });
});

describe('OI Projects — delete guard', () => {
  it('blocks deleting a project that is the sole link on a task', async () => {
    const project = await createOiProject({ title: 'Blocked', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', oiProjectId: project.id } as never, ACTOR);

    let error: unknown;
    try {
      await deleteOiProject(project.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('blocks deleting a project that is the sole link on a payment (crm_payments has its own anti-orphan CHECK)', async () => {
    const project = await createOiProject({ title: 'Payment-blocked', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    await db.run(sql`
      INSERT INTO crm_payments (id, label, amount, currency, direction, status, oi_project_id, created_at, updated_at, created_by)
      VALUES ('pay-1', 'Test', 1000, 'DZD', 'IN', 'EN_ATTENTE', ${project.id}, datetime('now'), datetime('now'), ${ACTOR})
    `);

    let error: unknown;
    try {
      await deleteOiProject(project.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    const err = error as CrmServiceError;
    expect(err.status).toBe(409);
    expect(err.message).toContain('paiements sans autre lien');
  });

  it('allows deleting a project with mobilized startups (their junction rows cascade)', async () => {
    const project = await createOiProject({ title: 'Cascade', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    const startup = await createStartup({ name: 'Startup B', pipelineStage: 'LEAD' }, ACTOR);
    await addOiStartup(project.id, startup.id, { status: 'PRESSENTIE' });

    await deleteOiProject(project.id);
    await expect(getOiProjectDetail(project.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);

    const links = await db.all(sql`SELECT * FROM crm_oi_startups WHERE oi_project_id = ${project.id}`);
    expect(links).toHaveLength(0);
  });
});
