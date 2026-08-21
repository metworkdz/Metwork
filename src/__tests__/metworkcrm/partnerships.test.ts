/**
 * METWORK OS CRM — Partnerships service.
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createPartnership,
  deletePartnership,
  getPartnershipDetail,
  listPartnerships,
  updatePartnership,
} from '@/server/metworkcrm/services/partnerships';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createContact } from '@/server/metworkcrm/services/contacts';
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
  await db.run(sql`DELETE FROM crm_partnership_contacts`);
  await db.run(sql`DELETE FROM crm_partnerships`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' }, ACTOR);
}

describe('Partnerships — CRUD', () => {
  it('creates a partnership, always tied to an organization', async () => {
    const org = await makeOrg();
    const partnership = await createPartnership({ name: 'Partenariat X', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT' }, ACTOR);
    expect(partnership.organizationId).toBe(org.id);
    expect(partnership.stage).toBe('PROSPECT');
  });

  it('bumps stageChangedAt only when stage actually changes', async () => {
    const org = await makeOrg('Org B');
    const partnership = await createPartnership({ name: 'Y', organizationId: org.id, type: 'ONG', stage: 'PROSPECT' }, ACTOR);
    await new Promise((r) => setTimeout(r, 2));
    const same = await updatePartnership(partnership.id, { description: 'x' });
    expect(same.stageChangedAt).toBe(partnership.stageChangedAt);

    const changed = await updatePartnership(partnership.id, { stage: 'CONTACTE' });
    expect(changed.stageChangedAt).not.toBe(partnership.stageChangedAt);
  });

  it('replaces the contact-link set wholesale on write', async () => {
    const org = await makeOrg('Org C');
    const c1 = (await createContact({ firstName: 'A', lastName: 'B', status: 'ACTIF' }, ACTOR)).contact;
    const c2 = (await createContact({ firstName: 'C', lastName: 'D', status: 'ACTIF' }, ACTOR)).contact;
    const partnership = await createPartnership(
      { name: 'Z', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT', contacts: [{ contactId: c1.id, role: 'Signataire' }] },
      ACTOR,
    );
    let detail = await getPartnershipDetail(partnership.id, { role: 'ADMIN' });
    expect(detail.contacts.map((c) => c.id)).toEqual([c1.id]);

    await updatePartnership(partnership.id, { contacts: [{ contactId: c2.id }] });
    detail = await getPartnershipDetail(partnership.id, { role: 'ADMIN' });
    expect(detail.contacts.map((c) => c.id)).toEqual([c2.id]);
  });

  it('throws CrmNotFoundError updating a missing partnership', async () => {
    await expect(updatePartnership('nope', { name: 'x' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('Partnerships — money redaction (dev rules R-19)', () => {
  it('ADMIN sees the value amount; TEAM_MEMBER does not', async () => {
    const org = await makeOrg('Org D');
    const partnership = await createPartnership(
      { name: 'W', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT', valueAmount: 200000 },
      ACTOR,
    );

    const asAdmin = await getPartnershipDetail(partnership.id, { role: 'ADMIN' });
    expect(asAdmin.partnership.valueAmount).toBe(200000);

    const asMember = await getPartnershipDetail(partnership.id, { role: 'TEAM_MEMBER' });
    expect(asMember.partnership.valueAmount).toBeNull();

    const list = await listPartnerships({ limit: 50, offset: 0 }, { role: 'TEAM_MEMBER' });
    expect(list.rows[0]!.valueAmount).toBeNull();
  });
});

describe('Partnerships — delete guard', () => {
  it('blocks deleting a partnership that is the sole link on a task', async () => {
    const org = await makeOrg('Org E');
    const partnership = await createPartnership({ name: 'Blocked', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT' }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', partnershipId: partnership.id } as never, ACTOR);

    let error: unknown;
    try {
      await deletePartnership(partnership.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting a partnership with no dependents, cascading its contact links', async () => {
    const org = await makeOrg('Org F');
    const c1 = (await createContact({ firstName: 'E', lastName: 'F', status: 'ACTIF' }, ACTOR)).contact;
    const partnership = await createPartnership(
      { name: 'Free', organizationId: org.id, type: 'CORPORATE', stage: 'PROSPECT', contacts: [{ contactId: c1.id }] },
      ACTOR,
    );
    await deletePartnership(partnership.id);
    await expect(getPartnershipDetail(partnership.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
