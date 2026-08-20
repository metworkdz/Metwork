import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createInteraction,
  deleteInteraction,
  listInteractions,
  listTimeline,
  updateInteraction,
} from '@/server/metworkcrm/services/interactions';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createContact } from '@/server/metworkcrm/services/contacts';
import { interactionInputSchema } from '@/server/metworkcrm/validation/interactions';
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
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_contacts`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

describe('Interactions — link requirement', () => {
  it('rejects an interaction with neither contact nor organization', () => {
    const result = interactionInputSchema.safeParse({
      type: 'APPEL',
      subject: 'Sans lien',
      occurredAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('accepts an interaction linked only to a contact', () => {
    const result = interactionInputSchema.safeParse({
      type: 'APPEL',
      subject: 'Avec contact',
      occurredAt: new Date().toISOString(),
      contactId: 'c1',
    });
    expect(result.success).toBe(true);
  });
});

describe('Interactions — next action fields (dashboard data model)', () => {
  it('stores next_action / next_action_date and lists items due today or earlier', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await createInteraction(
      { type: 'APPEL', subject: 'En retard', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Relancer', nextActionDate: yesterday, nextActionDone: false },
      ACTOR,
    );
    await createInteraction(
      { type: 'APPEL', subject: "Aujourd'hui", occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Appeler', nextActionDate: today, nextActionDone: false },
      ACTOR,
    );
    await createInteraction(
      { type: 'APPEL', subject: 'Futur', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Plus tard', nextActionDate: tomorrow, nextActionDone: false },
      ACTOR,
    );
    await createInteraction(
      { type: 'APPEL', subject: 'Déjà fait', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Fait', nextActionDate: yesterday, nextActionDone: true },
      ACTOR,
    );

    const due = await listInteractions({ nextActionDue: true, limit: 50, offset: 0 });
    expect(due.rows.map((r) => r.subject).sort()).toEqual(["Aujourd'hui", 'En retard']);
  });
});

describe('Interactions — timeline (reusable component data source)', () => {
  it('returns interactions for one organization, most recent first', async () => {
    const org = await createOrganization({ name: 'Entreprise ABC', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createInteraction({ type: 'REUNION', subject: '15 Aug Meeting', occurredAt: '2026-08-15T10:00:00.000Z', organizationId: org.id, nextActionDone: false }, ACTOR);
    await createInteraction({ type: 'EMAIL', subject: '17 Aug Email', occurredAt: '2026-08-17T10:00:00.000Z', organizationId: org.id, nextActionDone: false }, ACTOR);
    await createInteraction({ type: 'APPEL', subject: '18 Aug Call', occurredAt: '2026-08-18T10:00:00.000Z', organizationId: org.id, nextActionDone: false }, ACTOR);

    const timeline = await listTimeline({ organizationId: org.id });
    expect(timeline.map((t) => t.subject)).toEqual(['18 Aug Call', '17 Aug Email', '15 Aug Meeting']);
  });

  it('returns interactions for one contact', async () => {
    const { contact } = await createContact({ firstName: 'A', lastName: 'B', status: 'ACTIF' }, ACTOR);
    await createInteraction({ type: 'APPEL', subject: 'Contact call', occurredAt: new Date().toISOString(), contactId: contact.id, nextActionDone: false }, ACTOR);

    const timeline = await listTimeline({ contactId: contact.id });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.subject).toBe('Contact call');
  });

  it('returns nothing when neither id is given, rather than the whole table', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    await createInteraction({ type: 'APPEL', subject: 'X', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDone: false }, ACTOR);
    expect(await listTimeline({})).toEqual([]);
  });
});

describe('Interactions — update merges onto the existing row', () => {
  it('lets a caller flip nextActionDone without resubmitting the links', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const created = await createInteraction(
      { type: 'RELANCE', subject: 'À clore', occurredAt: new Date().toISOString(), organizationId: org.id, nextAction: 'Suivre', nextActionDate: '2026-08-20', nextActionDone: false },
      ACTOR,
    );

    // Simulates what the route does: parse, then keep only client-provided keys.
    const raw = { nextActionDone: true };
    const { interactionUpdateSchema } = await import('@/server/metworkcrm/validation/interactions');
    const parsed = interactionUpdateSchema.parse(raw);
    const patch = pickProvidedFields(raw, parsed);

    const updated = await updateInteraction(created.id, patch);
    expect(updated.nextActionDone).toBe(true);
    expect(updated.organizationId).toBe(org.id); // untouched
  });

  it('rejects a patch that would clear the only remaining link', async () => {
    const { contact } = await createContact({ firstName: 'A', lastName: 'B', status: 'ACTIF' }, ACTOR);
    const created = await createInteraction(
      { type: 'APPEL', subject: 'Seul lien', occurredAt: new Date().toISOString(), contactId: contact.id, nextActionDone: false },
      ACTOR,
    );

    const raw = { contactId: '' }; // explicit clear
    const { interactionUpdateSchema } = await import('@/server/metworkcrm/validation/interactions');
    const parsed = interactionUpdateSchema.parse(raw);
    const patch = pickProvidedFields(raw, parsed);

    await expect(updateInteraction(created.id, patch)).rejects.toBeInstanceOf(CrmServiceError);
  });
});

describe('Interactions — delete', () => {
  it('is a plain delete with no orphan guard (leaf entity)', async () => {
    const org = await createOrganization({ name: 'Org', type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
    const created = await createInteraction({ type: 'APPEL', subject: 'X', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDone: false }, ACTOR);
    await deleteInteraction(created.id);
    expect(await listTimeline({ organizationId: org.id })).toEqual([]);
  });
});
