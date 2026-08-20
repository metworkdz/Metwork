import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { globalSearch } from '@/server/metworkcrm/services/search';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createContact } from '@/server/metworkcrm/services/contacts';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { createInteraction } from '@/server/metworkcrm/services/interactions';

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
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Global search', () => {
  it('returns nothing for a query shorter than 2 characters (avoids scanning on every keystroke)', async () => {
    await createOrganization({ name: 'Ab', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    expect(await globalSearch('a')).toEqual([]);
    expect(await globalSearch('')).toEqual([]);
  });

  it('finds matches across all 4 entity types and groups them by kind', async () => {
    await createOrganization({ name: 'Atlas Ventures', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createContact({ firstName: 'Atlas', lastName: 'Contact', status: 'ACTIF' }, ACTOR);
    const org = await createOrganization({ name: 'Autre Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createTask({ title: 'Rappeler Atlas', priority: 'MOYENNE', status: 'INBOX', organizationId: org.id }, ACTOR);
    await createInteraction(
      { type: 'APPEL', subject: 'Appel Atlas', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDone: false },
      ACTOR,
    );

    const groups = await globalSearch('atlas');
    expect(groups.map((g) => g.kind).sort()).toEqual(['CONTACT', 'INTERACTION', 'ORGANIZATION', 'TASK']);

    const orgGroup = groups.find((g) => g.kind === 'ORGANIZATION')!;
    expect(orgGroup.items.map((i) => i.title)).toEqual(['Atlas Ventures']);
  });

  it('is case-insensitive', async () => {
    await createOrganization({ name: 'Metwork Coworking', type: 'INCUBATEUR', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const groups = await globalSearch('METWORK');
    expect(groups.find((g) => g.kind === 'ORGANIZATION')?.items[0]?.title).toBe('Metwork Coworking');
  });

  it('treats % and _ in the query as literal characters, not SQL wildcards', async () => {
    await createOrganization({ name: '50% Off Corp', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createOrganization({ name: 'Completely Unrelated', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);

    const groups = await globalSearch('50%');
    const orgGroup = groups.find((g) => g.kind === 'ORGANIZATION');
    expect(orgGroup?.items.map((i) => i.title)).toEqual(['50% Off Corp']);
  });

  it('matches contacts by email too', async () => {
    await createContact({ firstName: 'Sofiane', lastName: 'Kaci', email: 'sofiane.k@example.dz', status: 'ACTIF' }, ACTOR);
    const groups = await globalSearch('sofiane.k@example.dz');
    expect(groups.find((g) => g.kind === 'CONTACT')?.items[0]?.title).toBe('Sofiane Kaci');
  });

  it('omits a kind entirely when it has zero matches, rather than an empty group', async () => {
    await createOrganization({ name: 'OnlyOrgMatch', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const groups = await globalSearch('OnlyOrgMatch');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('ORGANIZATION');
  });
});
