import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createContact,
  deleteContact,
  getContactDetail,
  listContacts,
  replaceContactOrganizations,
  updateContact,
} from '@/server/metworkcrm/services/contacts';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { CrmNotFoundError, CrmServiceError } from '@/server/metworkcrm/services/errors';

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
  await db.run(sql`DELETE FROM crm_contact_organizations`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Contacts — CRUD', () => {
  it('creates and reads back a contact, with the computed full_name', async () => {
    const { contact } = await createContact({ firstName: 'Amina', lastName: 'Belkacem', status: 'ACTIF' }, ACTOR);
    expect(contact.fullName).toBe('Amina Belkacem');
    expect(contact.createdBy).toBe(ACTOR);
  });

  it('throws CrmNotFoundError updating a missing contact', async () => {
    await expect(updateContact('nope', { city: 'Alger' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('searches by full name and email', async () => {
    await createContact({ firstName: 'Karim', lastName: 'Haddad', email: 'karim@example.dz', status: 'ACTIF' }, ACTOR);
    await createContact({ firstName: 'Nadia', lastName: 'Ziani', email: 'nadia@example.dz', status: 'ACTIF' }, ACTOR);

    const byName = await listContacts({ q: 'haddad', limit: 50, offset: 0 });
    expect(byName.rows.map((r) => r.fullName)).toEqual(['Karim Haddad']);

    const byEmail = await listContacts({ q: 'nadia@example.dz', limit: 50, offset: 0 });
    expect(byEmail.rows.map((r) => r.fullName)).toEqual(['Nadia Ziani']);
  });
});

describe('Contacts — linked to one or more organizations', () => {
  it('links a contact to multiple organizations via the junction table', async () => {
    const org1 = await createOrganization({ name: 'Org 1', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const org2 = await createOrganization({ name: 'Org 2', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact } = await createContact({ firstName: 'M', lastName: 'B', status: 'ACTIF' }, ACTOR);

    await replaceContactOrganizations(contact.id, [
      { organizationId: org1.id, isPrimary: true, role: 'CEO' },
      { organizationId: org2.id, isPrimary: false, role: 'Board member' },
    ]);

    const detail = await getContactDetail(contact.id);
    expect(detail.organizations).toHaveLength(2);
    expect(detail.organizations.find((o) => o.id === org1.id)?.isPrimary).toBe(true);
    expect(detail.organizations.find((o) => o.id === org2.id)?.isPrimary).toBe(false);
  });

  it('keeps primary_organization_id in sync with the junction table', async () => {
    const org1 = await createOrganization({ name: 'Org 1', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const org2 = await createOrganization({ name: 'Org 2', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact } = await createContact({ firstName: 'M', lastName: 'B', status: 'ACTIF' }, ACTOR);

    await replaceContactOrganizations(contact.id, [{ organizationId: org1.id, isPrimary: true }]);
    let rows = await db.all<{ primary_organization_id: string | null }>(
      sql`SELECT primary_organization_id FROM crm_contacts WHERE id = ${contact.id}`,
    );
    expect(rows[0]?.primary_organization_id).toBe(org1.id);

    // Switching the primary flag to org2 must update the denormalized column.
    await replaceContactOrganizations(contact.id, [
      { organizationId: org1.id, isPrimary: false },
      { organizationId: org2.id, isPrimary: true },
    ]);
    rows = await db.all<{ primary_organization_id: string | null }>(
      sql`SELECT primary_organization_id FROM crm_contacts WHERE id = ${contact.id}`,
    );
    expect(rows[0]?.primary_organization_id).toBe(org2.id);

    // Clearing the link set entirely nulls it back out.
    await replaceContactOrganizations(contact.id, []);
    rows = await db.all<{ primary_organization_id: string | null }>(
      sql`SELECT primary_organization_id FROM crm_contacts WHERE id = ${contact.id}`,
    );
    expect(rows[0]?.primary_organization_id).toBeNull();
  });

  it('sets primary_organization_id from the initial organizations array at creation', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact } = await createContact(
      { firstName: 'M', lastName: 'B', status: 'ACTIF', organizations: [{ organizationId: org.id, isPrimary: true }] },
      ACTOR,
    );
    const rows = await db.all<{ primary_organization_id: string }>(
      sql`SELECT primary_organization_id FROM crm_contacts WHERE id = ${contact.id}`,
    );
    expect(rows[0]?.primary_organization_id).toBe(org.id);
  });

  it('filters the contact list by organization', async () => {
    const org = await createOrganization({ name: 'Filtre Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact: linked } = await createContact({ firstName: 'Lié', lastName: 'X', status: 'ACTIF' }, ACTOR);
    await createContact({ firstName: 'NonLié', lastName: 'Y', status: 'ACTIF' }, ACTOR);
    await replaceContactOrganizations(linked.id, [{ organizationId: org.id, isPrimary: true }]);

    const { rows } = await listContacts({ organizationId: org.id, limit: 50, offset: 0 });
    expect(rows.map((r) => r.id)).toEqual([linked.id]);
  });

  it('rejects two organizations both marked primary', async () => {
    const org1 = await createOrganization({ name: 'Org 1', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const org2 = await createOrganization({ name: 'Org 2', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contactOrganizationsReplaceSchema } = await import('@/server/metworkcrm/validation/contacts');
    const result = contactOrganizationsReplaceSchema.safeParse({
      organizations: [
        { organizationId: org1.id, isPrimary: true },
        { organizationId: org2.id, isPrimary: true },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('Contacts — delete guard', () => {
  it('blocks deleting a contact that is the sole link on an interaction', async () => {
    const { contact } = await createContact({ firstName: 'Solo', lastName: 'Link', status: 'ACTIF' }, ACTOR);
    const { createInteraction } = await import('@/server/metworkcrm/services/interactions');
    await createInteraction(
      { type: 'EMAIL', subject: 'Suivi', occurredAt: new Date().toISOString(), contactId: contact.id, nextActionDone: false },
      ACTOR,
    );

    let error: unknown;
    try {
      await deleteContact(contact.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
    expect((error as CrmServiceError).message).toContain('interactions sans autre lien');
  });

  it('allows deleting a contact with no dependents (its org-links cascade)', async () => {
    const org = await createOrganization({ name: 'Cascade Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact } = await createContact({ firstName: 'Free', lastName: 'ToDelete', status: 'ACTIF' }, ACTOR);
    await replaceContactOrganizations(contact.id, [{ organizationId: org.id, isPrimary: true }]);

    await deleteContact(contact.id);

    const links = await db.all(sql`SELECT * FROM crm_contact_organizations WHERE contact_id = ${contact.id}`);
    expect(links).toHaveLength(0);
  });

  it('allows deleting when the task has another link too', async () => {
    const org = await createOrganization({ name: 'Other link org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const { contact } = await createContact({ firstName: 'Has', lastName: 'OrgLink', status: 'ACTIF' }, ACTOR);
    await createTask(
      { title: 'Double', priority: 'BASSE', status: 'INBOX', contactId: contact.id, organizationId: org.id },
      ACTOR,
    );

    await deleteContact(contact.id); // must not throw
  });
});
