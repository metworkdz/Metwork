/**
 * Fixtures for the METWORK OS CRM e2e suite.
 *
 * The suite owns its accounts. It deliberately does NOT sign in as the seeded
 * `mohamed@metwork.dz` admin: that account ships with `must_change_password = 1`,
 * so a spec exercising the forced-change flow would flip the flag and the NEXT
 * run would not see the change screen — a suite that only passes once. Every
 * account here is created before the run and deleted after, so the seeded state
 * is never observed or mutated.
 *
 * `hashPassword` is imported from the application rather than reimplemented:
 * duplicating the scrypt format in a test would let the two drift, and a test
 * asserting against its own copy of the hashing logic proves nothing about
 * production.
 */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { hashPassword } from '../../../src/server/auth/password';

/** Same default the CRM's own env module uses. */
const CRM_DB_PATH = (process.env.METWORKCRM_DATABASE_URL ?? 'file:.crm-local.db').replace(
  /^file:/,
  '',
);

/** Marks every row this suite creates, so cleanup can be exact. */
export const E2E_TAG = 'e2e-crm';
const emailFor = (slug: string) => `${E2E_TAG}-${slug}@metwork.test`;

export interface CrmTestUser {
  id: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'TEAM_MEMBER';
}

function openDb() {
  return new Database(CRM_DB_PATH);
}

/**
 * Create an internal user directly in the CRM database. There is no
 * user-creation API yet (the Users module is still a placeholder), and going
 * through the DB is also what lets a spec choose `mustChangePassword`.
 */
export async function createCrmUser(opts: {
  slug: string;
  role: 'ADMIN' | 'TEAM_MEMBER';
  password: string;
  mustChangePassword?: boolean;
}): Promise<CrmTestUser> {
  const db = openDb();
  try {
    const id = randomUUID();
    const email = emailFor(opts.slug);
    const now = new Date().toISOString();
    // Re-runnable even if a previous run died before cleanup.
    db.prepare('DELETE FROM internal_users WHERE email = ?').run(email);
    db.prepare(
      `INSERT INTO internal_users
         (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      `E2E ${opts.slug}`,
      email,
      await hashPassword(opts.password),
      opts.role,
      opts.mustChangePassword ? 1 : 0,
      now,
      now,
    );
    return { id, email, password: opts.password, role: opts.role };
  } finally {
    db.close();
  }
}

/** Read a single user column back — used to assert server-side state, not UI state. */
export function readUserFlag(email: string, column: 'must_change_password' | 'is_active'): number | null {
  const db = openDb();
  try {
    const row = db.prepare(`SELECT ${column} AS v FROM internal_users WHERE email = ?`).get(email) as
      | { v: number }
      | undefined;
    return row?.v ?? null;
  } finally {
    db.close();
  }
}

/**
 * Remove everything this suite created.
 *
 * Order matters: the CRM's delete guard refuses to remove a row that is the
 * sole link on a dependent, and several tables carry anti-orphan CHECK
 * constraints. Deleting dependents first (tasks/interactions/notifications,
 * then pipeline entities, then organizations/contacts, then the users) avoids
 * both. Sessions cascade from `internal_users`.
 */
export function cleanupCrmFixtures(): void {
  const db = openDb();
  try {
    const ids = (sql: string) => (db.prepare(sql).all() as { id: string }[]).map((r) => r.id);
    const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(',') || "''";

    const orgIds = ids(`SELECT id FROM crm_organizations WHERE name LIKE '${E2E_TAG}%'`);
    const contactIds = ids(
      `SELECT id FROM crm_contacts WHERE first_name LIKE '${E2E_TAG}%' OR last_name LIKE '${E2E_TAG}%'`,
    );
    const oppIds = ids(`SELECT id FROM crm_opportunities WHERE title LIKE '${E2E_TAG}%'`);
    const startupIds = ids(`SELECT id FROM crm_startups WHERE name LIKE '${E2E_TAG}%'`);
    const userIds = ids(`SELECT id FROM internal_users WHERE email LIKE '${E2E_TAG}%'`);

    db.pragma('foreign_keys = ON');
    const tx = db.transaction(() => {
      /**
       * Delete dependents by FOREIGN KEY, not by title prefix.
       *
       * Tasks and interactions carry an anti-orphan CHECK: removing the entity
       * they point at NULLs the link (`ON DELETE SET NULL`), and if that was
       * their only link the CHECK fires and rolls back the whole DELETE. So
       * every task touching a fixture row has to go first.
       *
       * A title-prefix match is NOT sufficient: Prompt 7's automations generate
       * tasks named after the entity ("Kit de bienvenue envoyé — <startup>"),
       * so the tag lands mid-string. Matching on the FK catches those; matching
       * on the title silently misses them and the delete fails downstream.
       */
      db.prepare(
        `DELETE FROM crm_tasks WHERE
           title LIKE '${E2E_TAG}%'
           OR assignee_id     IN (${list(userIds)})
           OR organization_id IN (${list(orgIds)})
           OR contact_id      IN (${list(contactIds)})
           OR opportunity_id  IN (${list(oppIds)})
           OR startup_id      IN (${list(startupIds)})`,
      ).run();
      db.prepare(
        `DELETE FROM crm_interactions WHERE
           subject LIKE '${E2E_TAG}%'
           OR organization_id IN (${list(orgIds)})
           OR contact_id      IN (${list(contactIds)})
           OR opportunity_id  IN (${list(oppIds)})
           OR startup_id      IN (${list(startupIds)})`,
      ).run();
      db.prepare(`DELETE FROM crm_notifications WHERE user_id IN (${list(userIds)})`).run();
      db.prepare(
        `DELETE FROM crm_automation_runs WHERE trigger_entity_id IN (${list([
          ...oppIds,
          ...startupIds,
        ])})`,
      ).run();

      // Pipeline entities before the org/contact they point at.
      db.prepare(
        `DELETE FROM crm_opportunity_stage_history WHERE opportunity_id IN (${list(oppIds)})`,
      ).run();
      db.prepare(`DELETE FROM crm_opportunities WHERE id IN (${list(oppIds)})`).run();
      db.prepare(`DELETE FROM crm_startups WHERE id IN (${list(startupIds)})`).run();

      db.prepare(
        `DELETE FROM crm_contact_organizations WHERE organization_id IN (${list(
          orgIds,
        )}) OR contact_id IN (${list(contactIds)})`,
      ).run();
      db.prepare(`DELETE FROM crm_contacts WHERE id IN (${list(contactIds)})`).run();
      db.prepare(`DELETE FROM crm_organizations WHERE id IN (${list(orgIds)})`).run();
      // Sessions cascade from internal_users.
      db.prepare(`DELETE FROM internal_users WHERE id IN (${list(userIds)})`).run();
    });
    tx();
  } finally {
    db.close();
  }
}

/** Count leftover rows the suite is responsible for — asserted to be 0 after cleanup. */
export function countCrmFixtures(): number {
  const db = openDb();
  try {
    const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    return (
      q(`SELECT COUNT(*) n FROM internal_users WHERE email LIKE '${E2E_TAG}%'`) +
      q(`SELECT COUNT(*) n FROM crm_organizations WHERE name LIKE '${E2E_TAG}%'`) +
      q(`SELECT COUNT(*) n FROM crm_contacts WHERE first_name LIKE '${E2E_TAG}%'`) +
      q(`SELECT COUNT(*) n FROM crm_opportunities WHERE title LIKE '${E2E_TAG}%'`) +
      q(`SELECT COUNT(*) n FROM crm_startups WHERE name LIKE '${E2E_TAG}%'`) +
      q(`SELECT COUNT(*) n FROM crm_tasks WHERE title LIKE '${E2E_TAG}%'`)
    );
  } finally {
    db.close();
  }
}
