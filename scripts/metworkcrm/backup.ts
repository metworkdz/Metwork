/**
 * Consistent single-file snapshot of the METWORK OS CRM SQLite database.
 *
 *   npm run crm:backup            → backups/crm-<ISO>.db
 *   npm run crm:backup -- --out X → write to an explicit path instead
 *
 * WHY `VACUUM INTO` AND NOT `cp`:
 * the CRM database runs in WAL mode (see db/client.ts). In WAL mode a
 * committed transaction may live only in the `-wal` sibling until a
 * checkpoint folds it back into the main file, so copying `.crm-local.db`
 * alone can silently produce a snapshot that is missing recent writes — or,
 * if a write lands mid-copy, one that is internally torn. `VACUUM INTO` asks
 * SQLite itself for a transactionally consistent, already-compacted copy, and
 * is the documented way to hot-back-up a live database. It needs SQLite
 * ≥ 3.27; better-sqlite3 currently ships far newer.
 *
 * READ-ONLY against the source: the database is opened `readonly`, and
 * `VACUUM INTO` never mutates or checkpoints the original. Safe to run while
 * the dev server is up.
 *
 * TURSO / PRODUCTION IS DELIBERATELY OUT OF SCOPE — see the guard below and
 * METWORK_OS_RUNBOOK.md §2. `VACUUM INTO` writes to a local filesystem path,
 * which a remote libSQL database reached over HTTP has no access to; pointing
 * this script at Turso would produce either an error or, worse, a snapshot of
 * the wrong database. Restore/backup there is a different procedure, not a
 * flag on this one.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { crmDriverKind } from '../../src/server/metworkcrm/env';
import { CRM_TABLE_NAMES } from '../../src/server/metworkcrm/db/schema';

const BACKUP_DIR = path.resolve(process.cwd(), 'backups');

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** `--out <path>` override, for restore drills and ad-hoc snapshots. */
function outFlag(): string | null {
  const i = process.argv.indexOf('--out');
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

function main() {
  const url = process.env.METWORKCRM_DATABASE_URL ?? 'file:.crm-local.db';

  if (crmDriverKind(url) === 'libsql') {
    console.error(
      '✘ METWORKCRM_DATABASE_URL points at a remote libSQL/Turso database.\n' +
        '  `VACUUM INTO` writes to a LOCAL path and cannot snapshot a remote database,\n' +
        '  so this script refuses rather than producing a misleading file.\n' +
        '  Use the Turso procedure in METWORK_OS_RUNBOOK.md §2.2 instead.',
    );
    process.exit(1);
  }

  const sourcePath = path.resolve(process.cwd(), url.replace(/^file:/, ''));
  if (!fs.existsSync(sourcePath)) {
    console.error(`✘ CRM database not found at ${sourcePath}\n  Run \`npm run crm:setup\` first.`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = outFlag()
    ? path.resolve(process.cwd(), outFlag()!)
    : path.join(BACKUP_DIR, `crm-${stamp}.db`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    // VACUUM INTO refuses to overwrite; fail with a readable message instead
    // of SQLite's "output file already exists".
    console.error(`✘ Refusing to overwrite an existing file: ${target}`);
    process.exit(1);
  }

  const sizeBefore = fs.statSync(sourcePath).size;
  const mtimeBefore = fs.statSync(sourcePath).mtimeMs;

  // `readonly` is the belt: even a bug in this script cannot write to the live
  // database. VACUUM INTO is permitted on a readonly connection because it
  // only reads the source.
  const db = new Database(sourcePath, { readonly: true });
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } finally {
    db.close();
  }

  // Verify the snapshot before claiming success — a backup nobody has opened
  // is a hope, not a backup.
  const snapshot = new Database(target, { readonly: true });
  let integrity = 'unknown';
  let tableCount = 0;
  try {
    integrity = (snapshot.pragma('integrity_check', { simple: true }) as string) ?? 'unknown';
    tableCount = (
      snapshot
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .get() as { n: number }
    ).n;
  } finally {
    snapshot.close();
  }

  const sizeAfter = fs.statSync(sourcePath).size;
  const mtimeAfter = fs.statSync(sourcePath).mtimeMs;
  const sourceUntouched = sizeBefore === sizeAfter && mtimeBefore === mtimeAfter;

  console.log(`\n[crm:backup] source     ${path.relative(process.cwd(), sourcePath)}`);
  console.log(`[crm:backup] snapshot   ${path.relative(process.cwd(), target)}`);
  console.log(`[crm:backup] size       ${fmtBytes(fs.statSync(target).size)} (source ${fmtBytes(sizeAfter)})`);
  console.log(`[crm:backup] tables     ${tableCount} / ${CRM_TABLE_NAMES.length} expected`);
  console.log(`[crm:backup] integrity  ${integrity}`);
  console.log(`[crm:backup] source untouched: ${sourceUntouched ? 'yes' : 'NO — investigate'}`);

  const ok = integrity === 'ok' && tableCount === CRM_TABLE_NAMES.length && sourceUntouched;
  if (!ok) {
    console.error('\n✘ Snapshot failed verification — do NOT rely on this file.\n');
    process.exit(1);
  }
  console.log('\n✓ Backup verified. Restore instructions: METWORK_OS_RUNBOOK.md §2.\n');
}

main();
