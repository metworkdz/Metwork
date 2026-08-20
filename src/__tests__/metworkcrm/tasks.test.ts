import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { createTask, deleteTask, listTasks, updateTask } from '@/server/metworkcrm/services/tasks';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createContact } from '@/server/metworkcrm/services/contacts';
import { taskInputSchema } from '@/server/metworkcrm/validation/tasks';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { CrmServiceError } from '@/server/metworkcrm/services/errors';

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
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Tasks — no orphan tasks', () => {
  it('rejects a task with neither contact nor organization', () => {
    const result = taskInputSchema.safeParse({ title: 'Orpheline', priority: 'MOYENNE', status: 'INBOX' });
    expect(result.success).toBe(false);
  });

  it('accepts a task linked to an organization', () => {
    const result = taskInputSchema.safeParse({
      title: 'Avec org',
      priority: 'HAUTE',
      status: 'A_FAIRE',
      organizationId: 'o1',
    });
    expect(result.success).toBe(true);
  });
});

describe('Tasks — CRUD', () => {
  it('creates a task with priority/status/assignee and MANUAL source', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const task = await createTask(
      { title: 'Envoyer devis', description: 'Urgent', priority: 'URGENTE', status: 'A_FAIRE', organizationId: org.id, assigneeId: ACTOR },
      ACTOR,
    );
    expect(task.priority).toBe('URGENTE');
    expect(task.status).toBe('A_FAIRE');
    expect(task.assigneeId).toBe(ACTOR);
    expect(task.source).toBe('MANUAL');
  });

  it('stamps completedAt when moved to TERMINEE and clears it when reopened', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const task = await createTask({ title: 'T', priority: 'BASSE', status: 'A_FAIRE', organizationId: org.id }, ACTOR);
    expect(task.completedAt).toBeNull();

    const done = await updateTask(task.id, { status: 'TERMINEE' });
    expect(done.completedAt).not.toBeNull();

    const reopened = await updateTask(task.id, { status: 'EN_COURS' });
    expect(reopened.completedAt).toBeNull();
  });

  it('filters by status, priority and assignee', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createTask({ title: 'A', priority: 'URGENTE', status: 'INBOX', organizationId: org.id, assigneeId: ACTOR }, ACTOR);
    await createTask({ title: 'B', priority: 'BASSE', status: 'TERMINEE', organizationId: org.id }, ACTOR);

    const byStatus = await listTasks({ status: 'INBOX', limit: 50, offset: 0 });
    expect(byStatus.rows.map((r) => r.title)).toEqual(['A']);

    const byPriority = await listTasks({ priority: 'URGENTE', limit: 50, offset: 0 });
    expect(byPriority.rows.map((r) => r.title)).toEqual(['A']);

    const byAssignee = await listTasks({ assigneeId: ACTOR, limit: 50, offset: 0 });
    expect(byAssignee.rows.map((r) => r.title)).toEqual(['A']);
  });

  it('sorts open tasks before completed ones', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createTask({ title: 'Fait', priority: 'BASSE', status: 'TERMINEE', organizationId: org.id }, ACTOR);
    await createTask({ title: 'À faire', priority: 'BASSE', status: 'A_FAIRE', organizationId: org.id }, ACTOR);

    const { rows } = await listTasks({ limit: 50, offset: 0 });
    expect(rows[0]!.title).toBe('À faire');
    expect(rows[1]!.title).toBe('Fait');
  });
});

describe('Tasks — update merges onto the existing row', () => {
  it('lets a caller change status without resubmitting the links', async () => {
    const { contact } = await createContact({ firstName: 'A', lastName: 'B', status: 'ACTIF' }, ACTOR);
    const task = await createTask({ title: 'T', priority: 'MOYENNE', status: 'INBOX', contactId: contact.id }, ACTOR);

    const raw = { status: 'EN_COURS' };
    const { taskUpdateSchema } = await import('@/server/metworkcrm/validation/tasks');
    const parsed = taskUpdateSchema.parse(raw);
    const patch = pickProvidedFields(raw, parsed);

    const updated = await updateTask(task.id, patch);
    expect(updated.status).toBe('EN_COURS');
    expect(updated.contactId).toBe(contact.id);
  });

  it('rejects a patch that would clear the only remaining link', async () => {
    const { contact } = await createContact({ firstName: 'A', lastName: 'B', status: 'ACTIF' }, ACTOR);
    const task = await createTask({ title: 'T', priority: 'MOYENNE', status: 'INBOX', contactId: contact.id }, ACTOR);

    const raw = { contactId: '' };
    const { taskUpdateSchema } = await import('@/server/metworkcrm/validation/tasks');
    const parsed = taskUpdateSchema.parse(raw);
    const patch = pickProvidedFields(raw, parsed);

    await expect(updateTask(task.id, patch)).rejects.toBeInstanceOf(CrmServiceError);
  });

  it('throws CrmNotFoundError updating a missing task', async () => {
    const { CrmNotFoundError } = await import('@/server/metworkcrm/services/errors');
    await expect(updateTask('nope', { status: 'EN_COURS' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('Tasks — delete', () => {
  it('is a plain delete with no orphan guard (leaf entity)', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const task = await createTask({ title: 'T', priority: 'BASSE', status: 'INBOX', organizationId: org.id }, ACTOR);
    await deleteTask(task.id);
    const { rows } = await listTasks({ limit: 50, offset: 0 });
    expect(rows).toHaveLength(0);
  });
});
