/**
 * METWORK OS CRM — Payments service (product spec §4.14).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 *
 * Note: this file tests the SERVICE layer only. The ADMIN-only route guard
 * (`requireCrmApiAdmin` on every `/api/metworkcrm/payments/**` handler) is
 * verified separately — statically by `route-guards.test.ts` (payments is in
 * `ADMIN_ONLY_SEGMENTS`) and manually via a real TEAM_MEMBER browser login,
 * per the task's explicit request. See SESSION_LOG.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import {
  createPayment,
  deletePayment,
  getPaymentDetail,
  listPayments,
  updatePayment,
} from '@/server/metworkcrm/services/payments';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
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
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ACTOR);
}

describe('Payments — CRUD', () => {
  it('creates a payment linked to an organization', async () => {
    const org = await makeOrg();
    const payment = await createPayment(
      { label: 'Acompte', amount: 50000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    expect(payment.label).toBe('Acompte');
    expect(payment.amount).toBe(50000);
    expect(payment.status).toBe('EN_ATTENTE');
  });

  it('rejects a payment with no link at all', async () => {
    await expect(
      createPayment({ label: 'Orphan', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE' } as never, ACTOR),
    ).rejects.toThrow();
  });

  it('rejects updating a payment to have no link', async () => {
    const org = await makeOrg('Org B');
    const payment = await createPayment(
      { label: 'X', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    await expect(updatePayment(payment.id, { organizationId: null })).rejects.toBeInstanceOf(CrmServiceError);
  });

  it('throws CrmNotFoundError updating a missing payment', async () => {
    await expect(updatePayment('nope', { label: 'x' })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('filters by status/direction and searches by label', async () => {
    const org = await makeOrg('Org C');
    await createPayment({ label: 'Facture Alpha', amount: 1000, currency: 'DZD', direction: 'IN', status: 'PAYE', organizationId: org.id }, ACTOR);
    await createPayment({ label: 'Remboursement', amount: 500, currency: 'DZD', direction: 'OUT', status: 'EN_ATTENTE', organizationId: org.id }, ACTOR);

    const byStatus = await listPayments({ status: 'PAYE', limit: 50, offset: 0 });
    expect(byStatus.rows.map((r) => r.label)).toEqual(['Facture Alpha']);

    const byDirection = await listPayments({ direction: 'OUT', limit: 50, offset: 0 });
    expect(byDirection.rows.map((r) => r.label)).toEqual(['Remboursement']);

    const byQuery = await listPayments({ q: 'alpha', limit: 50, offset: 0 });
    expect(byQuery.rows.map((r) => r.label)).toEqual(['Facture Alpha']);
  });

  it('the overdue filter only returns EN_ATTENTE/RELANCE_1/RELANCE_2 with a past dueDate', async () => {
    const org = await makeOrg('Org D');
    await createPayment(
      { label: 'Overdue', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id, dueDate: '2020-01-01' },
      ACTOR,
    );
    await createPayment(
      { label: 'Already paid', amount: 1000, currency: 'DZD', direction: 'IN', status: 'PAYE', organizationId: org.id, dueDate: '2020-01-01' },
      ACTOR,
    );
    await createPayment(
      { label: 'Future', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id, dueDate: '2099-01-01' },
      ACTOR,
    );

    const overdue = await listPayments({ overdue: true, limit: 50, offset: 0 });
    expect(overdue.rows.map((r) => r.label)).toEqual(['Overdue']);
  });
});

describe('Payments — reminder/paid auto-stamping', () => {
  it('stamps reminder1SentAt on transition to RELANCE_1, not before', async () => {
    const org = await makeOrg('Org E');
    const payment = await createPayment(
      { label: 'X', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    expect(payment.reminder1SentAt).toBeNull();

    const afterRelance1 = await updatePayment(payment.id, { status: 'RELANCE_1' });
    expect(afterRelance1.reminder1SentAt).not.toBeNull();
    expect(afterRelance1.reminder2SentAt).toBeNull();
  });

  it('does not re-stamp reminder1SentAt if already set', async () => {
    const org = await makeOrg('Org F');
    const payment = await createPayment(
      { label: 'X', amount: 1000, currency: 'DZD', direction: 'IN', status: 'RELANCE_1', organizationId: org.id },
      ACTOR,
    );
    const firstStamp = payment.reminder1SentAt;
    await new Promise((r) => setTimeout(r, 2));
    const updated = await updatePayment(payment.id, { status: 'RELANCE_2' });
    expect(updated.reminder1SentAt).toBe(firstStamp);
    expect(updated.reminder2SentAt).not.toBeNull();
  });

  it('stamps paidAt on transition to PAYE', async () => {
    const org = await makeOrg('Org G');
    const payment = await createPayment(
      { label: 'X', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    expect(payment.paidAt).toBeNull();
    const paid = await updatePayment(payment.id, { status: 'PAYE' });
    expect(paid.paidAt).not.toBeNull();
  });
});

describe('Payments — delete guard', () => {
  it('blocks deleting a payment that is the sole link on a task', async () => {
    const org = await makeOrg('Org H');
    const payment = await createPayment(
      { label: 'Blocked', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    await createTask({ title: 'Seul lien', priority: 'MOYENNE', status: 'INBOX', paymentId: payment.id } as never, ACTOR);

    let error: unknown;
    try {
      await deletePayment(payment.id);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CrmServiceError);
    expect((error as CrmServiceError).status).toBe(409);
  });

  it('allows deleting a payment with no dependents', async () => {
    const org = await makeOrg('Org I');
    const payment = await createPayment(
      { label: 'Free', amount: 1000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', organizationId: org.id },
      ACTOR,
    );
    await deletePayment(payment.id);
    await expect(getPaymentDetail(payment.id)).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
