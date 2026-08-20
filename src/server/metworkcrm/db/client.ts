/**
 * METWORK OS CRM — database connection.
 *
 * THE ONLY FILE THAT KNOWS WHICH DRIVER IS ACTIVE (schema doc §12.1).
 * Application code imports `crmDb` and writes portable drizzle queries; it must
 * never branch on the environment, and never reach for a driver directly.
 *
 *   file:…       → better-sqlite3   (dev / test)
 *   libsql://…   → @libsql/client   (production, Turso)
 *   https://…    → @libsql/client   (production, Turso over HTTP)
 *
 * SERVER-ONLY, Node runtime only. Every CRM route must declare
 * `export const runtime = 'nodejs'` — neither driver works on Edge.
 */
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { drizzle as drizzleBetterSqlite } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
// Type-only: erased at build, so neither native/remote driver is pulled into
// the module graph by these imports. The runtime `require`s below are lazy on
// purpose — only the driver the URL selects is ever loaded.
import type BetterSqlite3 from 'better-sqlite3';
import type { createClient as CreateLibsqlClient } from '@libsql/client';
import { crmEnv, crmDriverKind } from '../env';
import * as schema from './schema';

/**
 * Driver-agnostic database type.
 *
 * NOT a union of `LibSQLDatabase | BetterSQLite3Database` — TypeScript cannot
 * resolve a method call across a union of two differently-typed query builders,
 * so every `.select().from().where()` fails to type-check. `BaseSQLiteDatabase`
 * is drizzle's shared supertype and is the supported way to write code that
 * runs on either driver.
 *
 * `'sync' | 'async'` covers both result kinds: query builders are thenable in
 * both drivers, so `await db.select()…` is correct either way.
 */
export type CrmDatabase = BaseSQLiteDatabase<'sync' | 'async', unknown, typeof schema>;

/**
 * Build a connection. Exported so scripts and tests can open an isolated
 * database (a temp file or `file::memory:`) without touching the shared
 * singleton below.
 */
export function createCrmDb(url?: string, authToken?: string): CrmDatabase {
  const env = crmEnv();
  const resolvedUrl = url ?? env.METWORKCRM_DATABASE_URL;
  const resolvedToken = authToken ?? env.METWORKCRM_DATABASE_AUTH_TOKEN;

  if (crmDriverKind(resolvedUrl) === 'libsql') {
    // Lazy require: keeps @libsql/client out of the dev bundle graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { createClient } = require('@libsql/client') as {
      createClient: typeof CreateLibsqlClient;
    };
    const client = createClient({ url: resolvedUrl, authToken: resolvedToken });
    // libSQL enables foreign keys by default, but that is a server-side default
    // we do not control by contract — assert it rather than assume it (R-29).
    // Fire-and-forget: Turso may reject PRAGMA over HTTP, in which case its own
    // default already applies.
    void client.execute('PRAGMA foreign_keys = ON').catch(() => {});
    return drizzleLibsql(client, { schema }) as CrmDatabase;
  }

  // better-sqlite3 wants a filesystem path, not a `file:` URL. `file::memory:`
  // and `:memory:` both mean an in-process database.
  const path = resolvedUrl.replace(/^file:/, '') || ':memory:';
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  const sqlite = new Database(path);
  // SQLite does NOT enforce foreign keys unless asked — without this every FK
  // in the schema is decorative (R-20).
  sqlite.pragma('foreign_keys = ON');
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL');
  return drizzleBetterSqlite(sqlite, { schema }) as CrmDatabase;
}

let cached: CrmDatabase | null = null;

/** Process-wide CRM connection. */
export function getCrmDb(): CrmDatabase {
  if (!cached) cached = createCrmDb();
  return cached;
}

/** TEST-ONLY: point the singleton at an isolated database. */
export function __setCrmDbForTests(db: CrmDatabase | null): void {
  cached = db;
}

export { schema };
