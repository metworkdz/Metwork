/**
 * METWORK OS CRM — Space bookings service (product spec §4.13).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createSpaceBooking,
  deleteSpaceBooking,
  getSpaceBookingDetail,
  listSpaceBookings,
  updateSpaceBooking,
} from '@/server/metworkcrm/services/space-bookings';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createPayment } from '@/server/metworkcrm/services/payments';
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
  await db.run(sql`DELETE FROM crm_space_bookings`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
}

describe('Space Bookings — CRUD', () => {
  it('creates a booking with an auto-generated, unique RES-YYYYMMDD-XXXX reference', async () => {
    const org = await makeOrg();
    const b1 = await createSpaceBooking({ spaceLabel: 'Salle Atlas', spaceType: 'SALLE_REUNION', status: 'DEMANDE', organizationId: org.id }, ACTOR);
    const b2 = await createSpaceBooking({ spaceLabel: 'Salle Atlas', spaceType: 'SALLE_REUNION', status: 'DEMANDE', organizationId: org.id }, ACTOR);
    expect(b1.reference).toMatch(/^RES-\d{8}-[A-F0-9]{4}$/);
    expect(b1.reference).not.toBe(b2.reference);
  });

  it('requires an organization or a contact', async () => {
    await expect(
      createSpaceBooking({ spaceLabel: 'Orphan', spaceType: 'COWORKING', status: 'DEMANDE' } as never, ACTOR),
    ).rejects.toThrow();
  });

  it('throws CrmNotFoundError updating a missing booking', async () => {
    await expect(updateSpaceBooking('nope', { spaceLabel: 'x' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by status and searches by space label or reference', async () => {
    const org = await makeOrg('Org B');
    const b = await createSpaceBooking({ spaceLabel: 'Bureau Nord', spaceType: 'BUREAU_PRIVE', status: 'CONFIRME', organizationId: org.id }, ACTOR);
    await createSpaceBooking({ spaceLabel: 'Bureau Sud', spaceType: 'BUREAU_PRIVE', status: 'DEMANDE', organizationId: org.id }, ACTOR);

    const byStatus = await listSpaceBookings({ status: 'CONFIRME', limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byStatus.rows.map((r) => r.spaceLabel)).toEqual(['Bureau Nord']);

    const byRef = await listSpaceBookings({ q: b.reference, limit: 50, offset: 0 }, { role: 'ADMIN' });
    expect(byRef.rows.map((r) => r.id)).toEqual([b.id]);
  });
});

describe('Space Bookings — money redaction (dev rules R-19)', () => {
  it('ADMIN sees quoted/final amounts; TEAM_MEMBER does not', async () => {
    const org = await makeOrg('Org C');
    const booking = await createSpaceBooking(
      { spaceLabel: 'Salle Confidentielle', spaceType: 'SALLE_FORMATION', status: 'DEVIS_ENVOYE', organizationId: org.id, quotedAmount: 30000, finalAmount: 28000 },
      ACTOR,
    );

    const asAdmin = await getSpaceBookingDetail(booking.id, { role: 'ADMIN' });
    expect(asAdmin.booking.quotedAmount).toBe(30000);
    expect(asAdmin.booking.finalAmount).toBe(28000);

    const asMember = await getSpaceBookingDetail(booking.id, { role: 'TEAM_MEMBER' });
    expect(asMember.booking.quotedAmount).toBeNull();
    expect(asMember.booking.finalAmount).toBeNull();
  });
});

describe('Space Bookings — delete guard', () => {
  it('blocks deleting a booking that is the sole link on a task', async () => {
    const org = await makeOrg('Org D');
    const booking = await createSpaceBooking({ spaceLabel: 'Blocked', spaceType: 'COWORKING', status: 'DEMANDE', organizationId: org.id }, ACTOR);
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', bookingId: booking.id } as never, ACTOR);

    let error: unknown;
    try {
      await deleteSpaceBooking(booking.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('blocks deleting a booking that is the sole link on a payment', async () => {
    const org = await makeOrg('Org E');
    const booking = await createSpaceBooking({ spaceLabel: 'Payment-blocked', spaceType: 'COWORKING', status: 'PAYE', organizationId: org.id }, ACTOR);
    await createPayment({ label: 'Acompte salle', amount: 5000, currency: 'DZD', direction: 'IN', status: 'PAYE', spaceBookingId: booking.id }, ACTOR);

    let error: unknown;
    try {
      await deleteSpaceBooking(booking.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    const err = error as CrmServiceError;
    expect(err.status).toBe(409);
    expect(err.message).toContain('paiements sans autre lien');
  });

  it('allows deleting a booking with no dependents', async () => {
    const org = await makeOrg('Org F');
    const booking = await createSpaceBooking({ spaceLabel: 'Free', spaceType: 'COWORKING', status: 'DEMANDE', organizationId: org.id }, ACTOR);
    await deleteSpaceBooking(booking.id);
    await expect(getSpaceBookingDetail(booking.id, { role: 'ADMIN' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
