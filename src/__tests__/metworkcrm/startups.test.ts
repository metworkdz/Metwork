/**
 * METWORK OS CRM — Startups service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createStartup,
  deleteStartup,
  getStartupDetail,
  listStartups,
  updateStartup,
} from '@/server/metworkcrm/services/startups';
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
  await db.run(sql`DELETE FROM crm_startups`);
  await db.run(sql`DELETE FROM crm_experts`);
});

describe('Startups — CRUD', () => {
  it('creates a CRM-only startup (no platform link)', async () => {
    const startup = await createStartup({ name: 'Startup A', pipelineStage: 'LEAD' }, ACTOR);
    expect(startup.name).toBe('Startup A');
    expect(startup.linkStatus).toBe('CRM_ONLY');
    expect(startup.platformListingId).toBeNull();
  });

  it('rejects a startup with neither a name nor a platform listing id', async () => {
    await expect(createStartup({ pipelineStage: 'LEAD' } as never, ACTOR)).rejects.toThrow();
  });

  it('sets linkStatus to LINKED when platformListingId is present', async () => {
    const startup = await createStartup({ platformListingId: 'listing-1', pipelineStage: 'LEAD' } as never, ACTOR);
    expect(startup.linkStatus).toBe('LINKED');
  });

  it('bumps stageChangedAt only when pipelineStage actually changes', async () => {
    const startup = await createStartup({ name: 'Startup B', pipelineStage: 'LEAD' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const sameStage = await updateStartup(startup.id, { city: 'Alger' });
    expect(sameStage.stageChangedAt).toBe(startup.stageChangedAt);

    const newStage = await updateStartup(startup.id, { pipelineStage: 'DIAGNOSTIC' });
    expect(newStage.stageChangedAt).not.toBe(startup.stageChangedAt);
  });

  it('throws CrmNotFoundError updating a missing startup', async () => {
    await expect(updateStartup('nope', { city: 'Oran' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by pipelineStage and searches case-insensitively', async () => {
    await createStartup({ name: 'Alpha Tech', pipelineStage: 'LEAD' }, ACTOR);
    await createStartup({ name: 'Beta Corp', pipelineStage: 'ACTIF' }, ACTOR);

    const byStage = await listStartups({ pipelineStage: 'ACTIF', limit: 50, offset: 0 });
    expect(byStage.rows.map((r) => r.name)).toEqual(['Beta Corp']);

    const byQuery = await listStartups({ q: 'alpha', limit: 50, offset: 0 });
    expect(byQuery.rows.map((r) => r.name)).toEqual(['Alpha Tech']);
  });
});

describe('Startups — detail aggregation', () => {
  it('resolves the assigned expert and linked tasks', async () => {
    const expert = await createExpert({ name: 'Coach X', pipelineStage: 'ACTIF' }, ACTOR);
    const startup = await createStartup({ name: 'Startup C', pipelineStage: 'ONBOARDING', assignedExpertId: expert.id }, ACTOR);
    await createTask({ title: 'Diagnostic', priority: 'HAUTE', status: 'A_FAIRE', startupId: startup.id } as never, ACTOR);

    const detail = await getStartupDetail(startup.id);
    expect(detail.assignedExpert?.id).toBe(expert.id);
    expect(detail.tasks).toHaveLength(1);
  });
});

describe('Startups — delete guard', () => {
  it('blocks deleting a startup that is the sole link on a task', async () => {
    const startup = await createStartup({ name: 'Startup D', pipelineStage: 'LEAD' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', startupId: startup.id } as never, ACTOR);

    let error: unknown;
    try {
      await deleteStartup(startup.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting a startup with no dependents', async () => {
    const startup = await createStartup({ name: 'Startup E', pipelineStage: 'LEAD' }, ACTOR);
    await deleteStartup(startup.id);
    await expect(getStartupDetail(startup.id)).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
