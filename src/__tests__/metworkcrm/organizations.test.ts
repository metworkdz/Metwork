/**
 * METWORK OS CRM — Organizations service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createOrganization,
  deleteOrganization,
  getOrganizationDetail,
  listOrganizations,
  updateOrganization,
} from '@/server/metworkcrm/services/organizations';
import { createContact, replaceContactOrganizations } from '@/server/metworkcrm/services/contacts';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { createInteraction } from '@/server/metworkcrm/services/interactions';
import { CrmServiceError, CrmNotFoundError } from '@/server/metworkcrm/services/errors';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ACTOR = 'test-actor';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  // created_by carries an FK to internal_users(id) — seed the actor every
  // service call in this file attributes writes to.
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ACTOR}, 'Test Actor', 'actor@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  // Wipe all rows written by the previous test, keep the schema.
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_contact_organizations`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Organizations — CRUD', () => {
  it('creates and reads back an organization', async () => {
    const org = await createOrganization(
      { name: 'Entreprise ABC', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' },
      ACTOR,
    );
    expect(org.name).toBe('Entreprise ABC');
    expect(org.createdBy).toBe(ACTOR);
    expect(org.status).toBe('PROSPECT');
  });

  it('updates fields and bumps updatedAt', async () => {
    const org = await createOrganization({ name: 'X', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updateOrganization(org.id, { city: 'Oran', status: 'ACTIF' });
    expect(updated.city).toBe('Oran');
    expect(updated.status).toBe('ACTIF');
    expect(updated.updatedAt).not.toBe(org.updatedAt);
  });

  it('throws CrmNotFoundError updating a missing organization', async () => {
    await expect(updateOrganization('does-not-exist', { city: 'Alger' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by type, status and city', async () => {
    await createOrganization({ name: 'Coworking Alger', type: 'INCUBATEUR', status: 'ACTIF', city: 'Alger', country: 'DZ' }, ACTOR);
    await createOrganization({ name: 'Boîte Oran', type: 'ENTREPRISE', status: 'PROSPECT', city: 'Oran', country: 'DZ' }, ACTOR);

    const byType = await listOrganizations({ type: 'INCUBATEUR', limit: 50, offset: 0 });
    expect(byType.rows.map((r) => r.name)).toEqual(['Coworking Alger']);

    const byCity = await listOrganizations({ city: 'Oran', limit: 50, offset: 0 });
    expect(byCity.rows.map((r) => r.name)).toEqual(['Boîte Oran']);

    const byStatus = await listOrganizations({ status: 'ACTIF', limit: 50, offset: 0 });
    expect(byStatus.rows.map((r) => r.name)).toEqual(['Coworking Alger']);
  });

  it('searches by name, case-insensitively, and treats % and _ as literals', async () => {
    await createOrganization({ name: 'Entreprise ABC', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    await createOrganization({ name: '50% Discount Corp', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);

    const r1 = await listOrganizations({ q: 'entreprise abc', limit: 50, offset: 0 });
    expect(r1.rows.map((r) => r.name)).toEqual(['Entreprise ABC']);

    // A literal "%" in the query must not act as a wildcard matching everything.
    const r2 = await listOrganizations({ q: '50%', limit: 50, offset: 0 });
    expect(r2.rows.map((r) => r.name)).toEqual(['50% Discount Corp']);
  });

  it('paginates with limit/offset and reports total independent of the page', async () => {
    for (let i = 0; i < 5; i++) {
      await createOrganization({ name: `Org ${i}`, type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    }
    const page1 = await listOrganizations({ limit: 2, offset: 0 });
    const page2 = await listOrganizations({ limit: 2, offset: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
  });
});

describe('Organizations — detail aggregation ("Entreprise ABC" pattern)', () => {
  it('shows every linked contact, interaction, task and (empty) opportunity list on one call', async () => {
    const org = await createOrganization({ name: 'Entreprise ABC', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const contact = (
      await createContact({ firstName: 'Amina', lastName: 'Belkacem', status: 'ACTIF' }, ACTOR)
    ).contact;
    await replaceContactOrganizations(contact.id, [{ organizationId: org.id, isPrimary: true, role: 'CEO' }]);

    await createInteraction(
      { type: 'APPEL', subject: 'Appel de découverte', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDone: false },
      ACTOR,
    );
    await createTask({ title: 'Envoyer la proposition', priority: 'HAUTE', status: 'A_FAIRE', organizationId: org.id }, ACTOR);

    const detail = await getOrganizationDetail(org.id);
    expect(detail.organization.name).toBe('Entreprise ABC');
    expect(detail.contacts).toHaveLength(1);
    expect(detail.contacts[0]!.id).toBe(contact.id);
    expect(detail.contacts[0]!.isPrimary).toBe(true);
    expect(detail.interactions).toHaveLength(1);
    expect(detail.tasks).toHaveLength(1);
    expect(detail.opportunities).toEqual([]); // Prompt 3 module — always empty until then, not an error
  });

  it('throws CrmNotFoundError for a missing organization', async () => {
    await expect(getOrganizationDetail('nope')).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('Organizations — delete guard', () => {
  it('allows deleting an organization with no dependents', async () => {
    const org = await createOrganization({ name: 'Vide', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    await deleteOrganization(org.id);
    await expect(getOrganizationDetail(org.id)).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('blocks deleting an organization that is the sole link on a task, with a readable message', async () => {
    const org = await createOrganization({ name: 'Bloquée', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', organizationId: org.id }, ACTOR);

    let error: unknown;
    try {
      await deleteOrganization(org.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    const err = error as CrmServiceError;
    expect(err.status).toBe(409);
    expect(err.message).toContain('tâches sans autre lien');
    expect(err.details?.blockers).toEqual([{ label: 'tâches sans autre lien', count: 1 }]);

    // Nothing was deleted — the org must still exist.
    const detail = await getOrganizationDetail(org.id);
    expect(detail.organization.id).toBe(org.id);
  });

  it('allows deleting an organization when its task has ANOTHER link too', async () => {
    const org = await createOrganization({ name: 'Double lien', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    const contact = (await createContact({ firstName: 'K', lastName: 'H', status: 'ACTIF' }, ACTOR)).contact;
    await createTask(
      { title: 'Double lien', priority: 'MOYENNE', status: 'INBOX', organizationId: org.id, contactId: contact.id },
      ACTOR,
    );

    await deleteOrganization(org.id); // must not throw

    const rows = await db.all<{ organization_id: string | null; contact_id: string }>(
      sql`SELECT organization_id, contact_id FROM crm_tasks WHERE title = 'Double lien'`,
    );
    expect(rows[0]?.organization_id).toBeNull();
    expect(rows[0]?.contact_id).toBe(contact.id);
  });

  it('cascades crm_contact_organizations rows without blocking the delete', async () => {
    const org = await createOrganization({ name: 'Cascade', type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
    const contact = (await createContact({ firstName: 'C', lastName: 'D', status: 'ACTIF' }, ACTOR)).contact;
    await replaceContactOrganizations(contact.id, [{ organizationId: org.id, isPrimary: true }]);

    await deleteOrganization(org.id);

    const links = await db.all(sql`SELECT * FROM crm_contact_organizations WHERE organization_id = ${org.id}`);
    expect(links).toHaveLength(0);
    // The contact itself survives; its primary_organization_id FK (ON DELETE
    // SET NULL) means it no longer points at the deleted org.
    const rows = await db.all<{ primary_organization_id: string | null }>(
      sql`SELECT primary_organization_id FROM crm_contacts WHERE id = ${contact.id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.primary_organization_id).toBeNull();
  });
});
