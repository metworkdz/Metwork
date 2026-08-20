/**
 * METWORK OS CRM — schema integrity.
 *
 * Runs against an ISOLATED in-memory database built from the real migration
 * files, so it never touches `.crm-local.db`, Supabase, or the platform's JSON
 * store. Does not disturb the suite's `fileParallelism: false` setting.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { CRM_TABLE_NAMES } from '@/server/metworkcrm/db/schema';

const MEM = 'file::memory:';
let db: CrmDatabase;

beforeAll(async () => {
  db = createCrmDb(MEM);
  await runCrmMigrations(db, MEM);
});

const NOW = '2026-08-20T10:00:00.000Z';

/**
 * Assert that a statement is refused.
 *
 * `db.run()` is SYNCHRONOUS on better-sqlite3 and asynchronous on libSQL, so
 * `expect(db.run(...)).rejects` is wrong for the file driver — the throw happens
 * while evaluating the argument, before expect() is ever called. This helper
 * normalizes both drivers.
 */
async function expectRefused(run: () => unknown): Promise<void> {
  let threw = false;
  try {
    await run();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

describe('CRM schema', () => {
  it('creates every table from the schema doc', async () => {
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
    );
    const found = rows.map((r) => r.name).sort();
    expect(found).toEqual([...CRM_TABLE_NAMES].sort());
    expect(found).toHaveLength(29);
  });

  it('enforces foreign keys (not merely declares them)', async () => {
    const rows = await db.all<Record<string, unknown>>(sql`PRAGMA foreign_keys`);
    expect(String(Object.values(rows[0] ?? {})[0])).toBe('1');
  });

  it('passes integrity_check with no dangling foreign keys', async () => {
    const integrity = await db.all<Record<string, string>>(sql`PRAGMA integrity_check`);
    expect(Object.values(integrity[0] ?? {})[0]).toBe('ok');
    const fk = await db.all(sql`PRAGMA foreign_key_check`);
    expect(fk).toHaveLength(0);
  });

  it('rejects an orphan task (no entity link)', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_tasks (id, title, priority, status, source, created_at, updated_at)
                 VALUES ('t1', 'orpheline', 'MOYENNE', 'INBOX', 'MANUAL', ${NOW}, ${NOW})`),
    );
  });

  it('accepts a task that is linked to at least one entity', async () => {
    await db.run(sql`INSERT INTO crm_organizations (id, name, type, status, country, created_at, updated_at)
                     VALUES ('org1', 'Entreprise ABC', 'ENTREPRISE', 'PROSPECT', 'DZ', ${NOW}, ${NOW})`);
    await db.run(sql`INSERT INTO crm_tasks (id, title, priority, status, source, organization_id, created_at, updated_at)
                     VALUES ('t2', 'liée', 'HAUTE', 'A_FAIRE', 'MANUAL', 'org1', ${NOW}, ${NOW})`);
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM crm_tasks WHERE id = 't2'`);
    expect(rows).toHaveLength(1);
  });

  it('rejects an interaction with no entity link', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_interactions (id, type, subject, occurred_at, next_action_done, created_at, updated_at)
                 VALUES ('i1', 'APPEL', 'sans lien', ${NOW}, 0, ${NOW}, ${NOW})`),
    );
  });

  it('rejects a startup with neither a name nor a platform listing', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_startups (id, pipeline_stage, stage_changed_at, created_at, updated_at)
                 VALUES ('s0', 'LEAD', ${NOW}, ${NOW}, ${NOW})`),
    );
  });

  it('computes link_status from platform_listing_id', async () => {
    await db.run(sql`INSERT INTO crm_startups (id, name, pipeline_stage, stage_changed_at, created_at, updated_at)
                     VALUES ('s1', 'Startup hors plateforme', 'LEAD', ${NOW}, ${NOW}, ${NOW})`);
    await db.run(sql`INSERT INTO crm_startups (id, platform_listing_id, pipeline_stage, stage_changed_at, created_at, updated_at)
                     VALUES ('s2', 'listing-abc', 'ACTIF', ${NOW}, ${NOW}, ${NOW})`);

    const rows = await db.all<{ id: string; link_status: string }>(
      sql`SELECT id, link_status FROM crm_startups WHERE id IN ('s1','s2') ORDER BY id`,
    );
    expect(rows.map((r) => r.link_status)).toEqual(['CRM_ONLY', 'LINKED']);
  });

  it('rejects a second CRM startup linked to the same platform listing', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_startups (id, platform_listing_id, pipeline_stage, stage_changed_at, created_at, updated_at)
                 VALUES ('s3', 'listing-abc', 'LEAD', ${NOW}, ${NOW}, ${NOW})`),
    );
  });

  it('computes full_name for contacts', async () => {
    await db.run(sql`INSERT INTO crm_contacts (id, first_name, last_name, status, created_at, updated_at)
                     VALUES ('c1', 'Amina', 'Belkacem', 'ACTIF', ${NOW}, ${NOW})`);
    const rows = await db.all<{ full_name: string }>(
      sql`SELECT full_name FROM crm_contacts WHERE id = 'c1'`,
    );
    expect(rows[0]?.full_name).toBe('Amina Belkacem');
  });

  it('rejects an invalid enum value', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_organizations (id, name, type, status, country, created_at, updated_at)
                 VALUES ('org2', 'X', 'PAS_UN_TYPE', 'PROSPECT', 'DZ', ${NOW}, ${NOW})`),
    );
  });

  it('rejects a payment with no entity link', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO crm_payments (id, label, amount, currency, direction, status, created_at, updated_at)
                 VALUES ('p1', 'sans lien', 1000, 'DZD', 'IN', 'EN_ATTENTE', ${NOW}, ${NOW})`),
    );
  });

  /**
   * The anti-orphan CHECK and `ON DELETE SET NULL` interact: deleting a linked
   * entity NULLs the link, which re-evaluates the CHECK on the dependent row.
   * If that was the row's ONLY link it becomes an orphan and the whole DELETE
   * is refused — atomically, so nothing is left half-written.
   *
   * This is fail-CLOSED and intentional (schema doc §2/§6): the CRM archives
   * (`status = 'ARCHIVE'`) rather than deletes. Prompt 2's delete service must
   * clear or re-point dependent rows first and surface a readable message.
   */
  it('refuses to delete an entity when that would orphan a dependent row', async () => {
    // t2 is linked to org1 and nothing else.
    await expectRefused(() =>
      db.run(sql`DELETE FROM crm_organizations WHERE id = 'org1'`),
    );
    const still = await db.all<{ id: string }>(sql`SELECT id FROM crm_organizations WHERE id = 'org1'`);
    expect(still).toHaveLength(1); // rolled back, not half-deleted
  });

  it('allows the delete once the dependent row has another link', async () => {
    await db.run(sql`INSERT INTO crm_organizations (id, name, type, status, country, created_at, updated_at)
                     VALUES ('org3', 'Org supprimable', 'ENTREPRISE', 'PROSPECT', 'DZ', ${NOW}, ${NOW})`);
    await db.run(sql`INSERT INTO crm_contacts (id, first_name, last_name, status, created_at, updated_at)
                     VALUES ('c9', 'Karim', 'Haddad', 'ACTIF', ${NOW}, ${NOW})`);
    // Linked to BOTH, so NULLing the org still leaves a valid link.
    await db.run(sql`INSERT INTO crm_tasks (id, title, priority, status, source, organization_id, contact_id, created_at, updated_at)
                     VALUES ('t9', 'double lien', 'BASSE', 'INBOX', 'MANUAL', 'org3', 'c9', ${NOW}, ${NOW})`);

    await db.run(sql`DELETE FROM crm_organizations WHERE id = 'org3'`);

    const task = await db.all<{ organization_id: string | null; contact_id: string }>(
      sql`SELECT organization_id, contact_id FROM crm_tasks WHERE id = 't9'`,
    );
    expect(task[0]?.organization_id).toBeNull();
    expect(task[0]?.contact_id).toBe('c9');
  });

  it('protects an organization that carries a partnership (ON DELETE RESTRICT)', async () => {
    await db.run(sql`INSERT INTO crm_organizations (id, name, type, status, country, created_at, updated_at)
                     VALUES ('org5', 'Org partenaire', 'ENTREPRISE', 'PROSPECT', 'DZ', ${NOW}, ${NOW})`);
    await db.run(sql`INSERT INTO crm_partnerships (id, name, organization_id, type, stage, stage_changed_at, created_at, updated_at)
                     VALUES ('pa1', 'Partenariat ABC', 'org5', 'CORPORATE', 'ACTIF', ${NOW}, ${NOW}, ${NOW})`);
    // No tasks on org5 — so this is the FK RESTRICT firing, not the orphan CHECK.
    await expectRefused(() =>
      db.run(sql`DELETE FROM crm_organizations WHERE id = 'org5'`),
    );
  });

  it('is idempotent — re-running migrations changes nothing', async () => {
    await runCrmMigrations(db, MEM);
    const rows = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
    );
    expect(rows[0]?.n).toBe(29);
  });
});
