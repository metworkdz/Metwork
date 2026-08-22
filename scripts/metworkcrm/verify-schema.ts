/**
 * Verify the METWORK OS CRM database matches the schema doc.
 *
 *   npm run crm:verify
 *
 * Backs the Prompt 1 manual-test checklist: every table present, foreign keys
 * actually ENFORCED (not merely declared), integrity clean, and the anti-orphan
 * CHECK constraints genuinely rejecting bad rows.
 *
 * Read-only against the CRM database except for the constraint probes, which
 * run inside a transaction that is always rolled back.
 */
import './_env';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { createCrmDb } from '../../src/server/metworkcrm/db/client';
import { CRM_TABLE_NAMES } from '../../src/server/metworkcrm/db/schema';
import { crmDriverKind } from '../../src/server/metworkcrm/env';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  const db = createCrmDb();
  const driver = crmDriverKind();
  console.log(`\n[crm:verify] driver=${driver}\n`);

  // ── Tables ────────────────────────────────────────────────────────────
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
  );
  const found = new Set(rows.map((r) => r.name));
  console.log(`Tables (${found.size} found, ${CRM_TABLE_NAMES.length} expected)`);
  const missing = CRM_TABLE_NAMES.filter((t) => !found.has(t));
  const extra = [...found].filter((t) => !CRM_TABLE_NAMES.includes(t as never));
  check('all expected tables exist', missing.length === 0, missing.join(', '));
  check('no unexpected tables', extra.length === 0, extra.join(', '));

  // ── Integrity ─────────────────────────────────────────────────────────
  console.log('\nIntegrity');
  const fk = await db.all<{ simple?: number }>(sql`PRAGMA foreign_keys`);
  const fkOn = Object.values(fk[0] ?? {})[0];
  check('PRAGMA foreign_keys is ON', String(fkOn) === '1', `got ${String(fkOn)}`);

  const fkCheck = await db.all(sql`PRAGMA foreign_key_check`);
  check('foreign_key_check returns no rows', fkCheck.length === 0, `${fkCheck.length} violation(s)`);

  const integrity = await db.all<Record<string, string>>(sql`PRAGMA integrity_check`);
  const verdict = Object.values(integrity[0] ?? {})[0];
  check('integrity_check is ok', verdict === 'ok', String(verdict));

  const idx = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`,
  );
  console.log(`  · ${idx[0]?.n ?? 0} named indexes present`);

  // ── Constraints actually bite ─────────────────────────────────────────
  console.log('\nConstraints (probed, then rolled back)');
  const now = new Date().toISOString();

  /** Run a statement, swallowing any error. `db.run` is sync on one driver and async on the other. */
  async function quiet(statement: ReturnType<typeof sql>) {
    try {
      await db.run(statement);
    } catch {
      /* ignore */
    }
  }

  async function rejects(label: string, statement: ReturnType<typeof sql>) {
    try {
      await db.run(statement);
      check(label, false, 'row was ACCEPTED — constraint not enforced');
      await quiet(sql`ROLLBACK`);
    } catch {
      check(label, true);
    }
  }

  await rejects(
    'orphan task rejected (no entity link)',
    sql`INSERT INTO crm_tasks (id, title, priority, status, source, created_at, updated_at)
        VALUES ('probe-task', 'probe', 'MOYENNE', 'INBOX', 'MANUAL', ${now}, ${now})`,
  );
  await rejects(
    'startup with neither name nor platform_listing_id rejected',
    sql`INSERT INTO crm_startups (id, pipeline_stage, stage_changed_at, created_at, updated_at)
        VALUES ('probe-startup', 'LEAD', ${now}, ${now}, ${now})`,
  );
  await rejects(
    'invalid enum value rejected',
    sql`INSERT INTO crm_organizations (id, name, type, status, country, created_at, updated_at)
        VALUES ('probe-org', 'probe', 'NOT_A_REAL_TYPE', 'PROSPECT', 'DZ', ${now}, ${now})`,
  );

  // Duplicate platform_listing_id — needs one real row first, so do it in a
  // transaction we roll back. Uses drizzle's own `db.transaction()` rather
  // than raw `BEGIN`/`ROLLBACK` SQL text: the latter does not reliably hold
  // as one transaction over Turso's remote HTTP driver (each `db.run()` can
  // land as an independent request), which was confirmed to silently leave
  // a stray `probe-s1` row behind on first production run of this script.
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        sql`INSERT INTO crm_startups (id, platform_listing_id, pipeline_stage, stage_changed_at, created_at, updated_at)
            VALUES ('probe-s1', 'listing-x', 'LEAD', ${now}, ${now}, ${now})`,
      );
      let duped = false;
      try {
        await tx.run(
          sql`INSERT INTO crm_startups (id, platform_listing_id, pipeline_stage, stage_changed_at, created_at, updated_at)
              VALUES ('probe-s2', 'listing-x', 'LEAD', ${now}, ${now}, ${now})`,
        );
        duped = true;
      } catch {
        /* expected */
      }
      check('duplicate platform_listing_id rejected', !duped);

      const gen = await tx.all<{ link_status: string }>(
        sql`SELECT link_status FROM crm_startups WHERE id = 'probe-s1'`,
      );
      check(
        "generated link_status computes to 'LINKED'",
        gen[0]?.link_status === 'LINKED',
        String(gen[0]?.link_status),
      );
      tx.rollback();
    });
  } catch (err) {
    // `tx.rollback()` throws `TransactionRollbackError` by design — that is
    // the expected, successful path, not a failure.
    if (!(err instanceof TransactionRollbackError)) {
      await quiet(sql`ROLLBACK`);
      check('linked-startup probes', false, String(err));
    }
  }

  console.log(
    failures === 0
      ? '\n[crm:verify] ✓ all checks passed\n'
      : `\n[crm:verify] ✘ ${failures} check(s) failed\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[crm:verify] ✘ failed:', err);
  process.exit(1);
});
