/**
 * Apply METWORK OS CRM migrations. Idempotent — safe to re-run.
 *
 *   npm run crm:migrate
 *
 * Never touches the platform's JSON store (Supabase `app_state` /
 * `.local-db.json`). This database is entirely separate.
 */
import { CRM_DATABASE_URL } from './_env';
import { createCrmDb } from '../../src/server/metworkcrm/db/client';
import { runCrmMigrations } from '../../src/server/metworkcrm/db/migrate';
import { crmDriverKind } from '../../src/server/metworkcrm/env';

async function main() {
  const kind = crmDriverKind(CRM_DATABASE_URL);
  const shown = CRM_DATABASE_URL.replace(/(authToken=)[^&]+/, '$1***');
  console.log(`[crm:migrate] driver=${kind} url=${shown}`);

  const db = createCrmDb();
  await runCrmMigrations(db);
  console.log('[crm:migrate] ✓ migrations applied (re-run is a no-op)');
}

main().catch((err) => {
  console.error('[crm:migrate] ✘ failed:', err);
  process.exit(1);
});
