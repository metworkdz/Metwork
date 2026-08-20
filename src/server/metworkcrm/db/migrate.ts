/**
 * METWORK OS CRM — migration runner.
 *
 * Idempotent by construction: drizzle records applied migrations in its own
 * `__drizzle_migrations` table, so re-running is a no-op.
 *
 * Invoked ONLY from an explicit CLI script (`npm run crm:migrate`) or from a
 * test's setup — never at request time. A migration racing across serverless
 * instances is a corruption scenario (dev rules R-21).
 */
import path from 'node:path';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { crmDriverKind, crmEnv } from '../env';
import type { CrmDatabase } from './client';
import type * as schema from './schema';

export const CRM_MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle', 'metworkcrm');

export async function runCrmMigrations(db: CrmDatabase, url?: string): Promise<void> {
  const resolvedUrl = url ?? crmEnv().METWORKCRM_DATABASE_URL;

  if (crmDriverKind(resolvedUrl) === 'libsql') {
    const { migrate } = await import('drizzle-orm/libsql/migrator');
    await migrate(db as LibSQLDatabase<typeof schema>, {
      migrationsFolder: CRM_MIGRATIONS_FOLDER,
    });
    return;
  }

  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db as BetterSQLite3Database<typeof schema>, {
    migrationsFolder: CRM_MIGRATIONS_FOLDER,
  });
}
