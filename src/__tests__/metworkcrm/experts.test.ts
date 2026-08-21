/**
 * METWORK OS CRM — Experts service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createExpert,
  deleteExpert,
  getExpertDetail,
  listExperts,
  updateExpert,
} from '@/server/metworkcrm/services/experts';
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
  await db.run(sql`DELETE FROM crm_experts`);
});

describe('Experts — CRUD', () => {
  it('creates a CRM-only expert with specialties round-tripped as a plain array', async () => {
    const expert = await createExpert({ name: 'Coach A', pipelineStage: 'PROSPECT', specialties: ['Marketing', 'Fundraising'] }, ACTOR);
    expect(expert.linkStatus).toBe('CRM_ONLY');
    expect(expert.specialties).toEqual(['Marketing', 'Fundraising']);
  });

  it('rejects an expert with neither a name nor a platform mentor id', async () => {
    await expect(createExpert({ pipelineStage: 'PROSPECT' } as never, ACTOR)).rejects.toThrow();
  });

  it('sets linkStatus to LINKED when platformMentorId is present', async () => {
    const expert = await createExpert({ platformMentorId: 'mentor-1', pipelineStage: 'ACTIF' } as never, ACTOR);
    expect(expert.linkStatus).toBe('LINKED');
  });

  it('updates specialties, replacing the full list', async () => {
    const expert = await createExpert({ name: 'Coach B', pipelineStage: 'PROSPECT', specialties: ['A'] }, ACTOR);
    const updated = await updateExpert(expert.id, { specialties: ['B', 'C'] });
    expect(updated.specialties).toEqual(['B', 'C']);
  });

  it('clears specialties when given an empty array', async () => {
    const expert = await createExpert({ name: 'Coach C', pipelineStage: 'PROSPECT', specialties: ['A'] }, ACTOR);
    const updated = await updateExpert(expert.id, { specialties: [] });
    expect(updated.specialties).toEqual([]);
  });

  it('bumps stageChangedAt only when pipelineStage actually changes', async () => {
    const expert = await createExpert({ name: 'Coach D', pipelineStage: 'PROSPECT' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const same = await updateExpert(expert.id, { city: 'Alger' });
    expect(same.stageChangedAt).toBe(expert.stageChangedAt);

    const changed = await updateExpert(expert.id, { pipelineStage: 'CONTACTE' });
    expect(changed.stageChangedAt).not.toBe(expert.stageChangedAt);
  });

  it('throws CrmNotFoundError updating a missing expert', async () => {
    await expect(updateExpert('nope', { city: 'Oran' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('Experts — money redaction (dev rules R-19)', () => {
  it('ADMIN sees the daily rate; TEAM_MEMBER does not', async () => {
    const expert = await createExpert({ name: 'Coach E', pipelineStage: 'ACTIF', dailyRate: 30000 }, ACTOR);

    const asAdmin = await getExpertDetail(expert.id, { role: 'ADMIN' });
    expect(asAdmin.expert.dailyRate).toBe(30000);

    const asMember = await getExpertDetail(expert.id, { role: 'TEAM_MEMBER' });
    expect(asMember.expert.dailyRate).toBeNull();

    const list = await listExperts({ limit: 50, offset: 0 }, { role: 'TEAM_MEMBER' });
    expect(list.rows[0]!.dailyRate).toBeNull();
  });
});

describe('Experts — delete guard', () => {
  it('blocks deleting an expert that is the sole link on a task', async () => {
    const expert = await createExpert({ name: 'Coach F', pipelineStage: 'PROSPECT' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', expertId: expert.id } as never, ACTOR);

    let error: unknown;
    try {
      await deleteExpert(expert.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting an expert with no dependents', async () => {
    const expert = await createExpert({ name: 'Coach G', pipelineStage: 'PROSPECT' }, ACTOR);
    await deleteExpert(expert.id);
    await expect(getExpertDetail(expert.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
