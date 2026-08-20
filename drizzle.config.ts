import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config for the METWORK OS CRM database.
 *
 * Dialect is `sqlite` (not `turso`) on purpose: generation then emits plain
 * SQLite DDL that BOTH drivers accept verbatim — `better-sqlite3` locally and
 * `@libsql/client` against Turso in production. One schema, one migration set,
 * two drivers (METWORK_OS_DATABASE_SCHEMA.md §12).
 *
 * `dbCredentials` is only consulted by `drizzle-kit push`/`studio`. The
 * `crm:migrate` script applies migrations through the app's own connection
 * module so the driver choice stays in exactly one place.
 */
export default defineConfig({
  schema: './src/server/metworkcrm/db/schema.ts',
  out: './drizzle/metworkcrm',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.METWORKCRM_DATABASE_URL ?? 'file:.crm-local.db',
  },
  strict: true,
  verbose: true,
});
