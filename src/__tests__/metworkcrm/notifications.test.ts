/**
 * METWORK OS CRM — Notifications (product spec §4.16, Prompt 7).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { crmTasks } from '@/server/metworkcrm/db/schema';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  syncNotifications,
} from '@/server/metworkcrm/services/notifications';
import { createOrganization } from '@/server/metworkcrm/services/organizations';
import { createTask } from '@/server/metworkcrm/services/tasks';
import { createInteraction } from '@/server/metworkcrm/services/interactions';
import { createOpportunity } from '@/server/metworkcrm/services/opportunities';
import { createPayment } from '@/server/metworkcrm/services/payments';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ADMIN = 'test-admin';
const ADMIN2 = 'test-admin-2';
const MEMBER = 'test-member';

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ADMIN}, 'Admin', 'admin@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now}),
           (${ADMIN2}, 'Admin Two', 'admin2@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now}),
           (${MEMBER}, 'Membre', 'member@metwork.dz', 'x', 'TEAM_MEMBER', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_notifications`);
  await db.run(sql`DELETE FROM crm_automation_runs`);
  await db.run(sql`DELETE FROM crm_tasks`);
  await db.run(sql`DELETE FROM crm_interactions`);
  await db.run(sql`DELETE FROM crm_payments`);
  await db.run(sql`DELETE FROM crm_opportunity_stage_history`);
  await db.run(sql`DELETE FROM crm_opportunities`);
  await db.run(sql`DELETE FROM crm_organizations`);
});

async function makeOrg(name = 'Org A') {
  return createOrganization({ name, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' }, ADMIN);
}

describe('Notification sweep — task due today', () => {
  it('notifies the assignee, not other users, and does not duplicate on a re-sync', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Call the client', priority: 'HAUTE', status: 'A_FAIRE', dueDate: isoDate(0), assigneeId: MEMBER, organizationId: org.id }, ADMIN);

    await syncNotifications();
    await syncNotifications();

    const { rows: memberRows } = await listNotifications(MEMBER);
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]!.type).toBe('TACHE_DUE');

    const { rows: adminRows } = await listNotifications(ADMIN);
    expect(adminRows).toHaveLength(0);
  });

  it('does not notify for a task due tomorrow', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Future task', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(1), assigneeId: MEMBER, organizationId: org.id }, ADMIN);
    await syncNotifications();
    const { rows } = await listNotifications(MEMBER);
    expect(rows).toHaveLength(0);
  });
});

describe('Notification sweep — follow-up due today', () => {
  it('notifies whoever logged the interaction', async () => {
    const org = await makeOrg();
    await createInteraction(
      { type: 'APPEL', subject: 'Follow up call', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDate: isoDate(0), nextActionDone: false },
      MEMBER,
    );
    await syncNotifications();
    const { rows } = await listNotifications(MEMBER);
    expect(rows.filter((r) => r.type === 'RELANCE_DUE')).toHaveLength(1);
  });
});

describe('Notification sweep — payment overdue', () => {
  it('notifies every ADMIN (not TEAM_MEMBER) and creates one "Relance paiement" task', async () => {
    const org = await makeOrg();
    await createPayment(
      { label: 'Facture 100', amount: 10000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', dueDate: isoDate(-3), organizationId: org.id },
      ADMIN,
    );

    await syncNotifications();
    await syncNotifications(); // re-sync must not duplicate

    const { rows: admin1 } = await listNotifications(ADMIN);
    const { rows: admin2 } = await listNotifications(ADMIN2);
    const { rows: member } = await listNotifications(MEMBER);
    expect(admin1.filter((r) => r.type === 'PAIEMENT_RETARD')).toHaveLength(1);
    expect(admin2.filter((r) => r.type === 'PAIEMENT_RETARD')).toHaveLength(1);
    expect(member).toHaveLength(0);

    const tasks = await db.select().from(crmTasks).where(eq(crmTasks.title, 'Relance paiement — Facture 100'));
    expect(tasks).toHaveLength(1);
  });

  it('does not notify for a payment not yet due', async () => {
    const org = await makeOrg();
    await createPayment(
      { label: 'Facture 200', amount: 5000, currency: 'DZD', direction: 'IN', status: 'EN_ATTENTE', dueDate: isoDate(5), organizationId: org.id },
      ADMIN,
    );
    await syncNotifications();
    const { rows } = await listNotifications(ADMIN);
    expect(rows.filter((r) => r.type === 'PAIEMENT_RETARD')).toHaveLength(0);
  });
});

describe('Notification sweep — meeting in 30 minutes', () => {
  it('notifies when dueAt is 20 minutes out, not 40 minutes out', async () => {
    const org = await makeOrg();
    const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 40 * 60 * 1000).toISOString();
    await createTask({ title: 'Réunion client', priority: 'HAUTE', status: 'A_FAIRE', dueAt: soon, assigneeId: MEMBER, organizationId: org.id }, ADMIN);
    await createTask({ title: 'Réunion plus tard', priority: 'HAUTE', status: 'A_FAIRE', dueAt: later, assigneeId: MEMBER, organizationId: org.id }, ADMIN);

    await syncNotifications();
    const { rows } = await listNotifications(MEMBER);
    const meetingNotifs = rows.filter((r) => r.type === 'REUNION_30MIN');
    expect(meetingNotifs).toHaveLength(1);
    expect(meetingNotifs[0]!.body).toBe('Réunion client');
  });
});

describe('Notification sweep — opportunity inactive 7+ days', () => {
  it('notifies the owner once stage_changed_at is 7+ days old, not before', async () => {
    const org = await makeOrg();
    const opp = await createOpportunity({ title: 'Stale deal', organizationId: org.id, type: 'CONSULTING', stage: 'CONTACTE', ownerId: MEMBER }, ADMIN);
    await syncNotifications();
    let { rows } = await listNotifications(MEMBER);
    expect(rows.filter((r) => r.type === 'OPPORTUNITE_INACTIVE')).toHaveLength(0);

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(sql`UPDATE crm_opportunities SET stage_changed_at = ${eightDaysAgo} WHERE id = ${opp.id}`);
    await syncNotifications();
    ({ rows } = await listNotifications(MEMBER));
    expect(rows.filter((r) => r.type === 'OPPORTUNITE_INACTIVE')).toHaveLength(1);
  });
});

describe('Notifications — read state', () => {
  it('marks one notification read, scoped to the caller — another user cannot mark someone else\'s', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Task', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(0), assigneeId: MEMBER, organizationId: org.id }, ADMIN);
    await syncNotifications();

    const { rows } = await listNotifications(MEMBER);
    expect(rows).toHaveLength(1);
    const notifId = rows[0]!.id;

    await markNotificationRead(notifId, ADMIN); // wrong user — no-op
    let after = await listNotifications(MEMBER);
    expect(after.unreadCount).toBe(1);

    await markNotificationRead(notifId, MEMBER);
    after = await listNotifications(MEMBER);
    expect(after.unreadCount).toBe(0);
    expect(after.rows[0]!.read).toBe(true);
  });

  it('marks all of a user\'s notifications read in one call', async () => {
    const org = await makeOrg();
    await createTask({ title: 'Task 1', priority: 'MOYENNE', status: 'A_FAIRE', dueDate: isoDate(0), assigneeId: MEMBER, organizationId: org.id }, ADMIN);
    await createInteraction(
      { type: 'APPEL', subject: 'Call', occurredAt: new Date().toISOString(), organizationId: org.id, nextActionDate: isoDate(0), nextActionDone: false },
      MEMBER,
    );
    await syncNotifications();

    const before = await listNotifications(MEMBER);
    expect(before.unreadCount).toBe(2);

    await markAllNotificationsRead(MEMBER);
    const after = await listNotifications(MEMBER);
    expect(after.unreadCount).toBe(0);
  });
});
