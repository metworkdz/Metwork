/**
 * Seed the METWORK OS CRM admin account. Idempotent — safe to re-run.
 *
 *   npm run crm:seed
 *
 * The password hash is computed at run time with the platform's own scrypt
 * implementation (dev rules R-16 — reuse, never reinvent). No hash is ever
 * committed to the repo.
 *
 * `mustChangePassword` is set so the seeded credential cannot survive first
 * login: the CRM forces a password change before any other page is reachable.
 */
import './_env';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createCrmDb } from '../../src/server/metworkcrm/db/client';
import { internalUsers } from '../../src/server/metworkcrm/db/schema';
import { hashPassword } from '../../src/server/auth/password';

const SEED_EMAIL = 'mohamed@metwork.dz';
const SEED_NAME = 'Mohamed';

/**
 * Default initial password. Overridable via METWORKCRM_SEED_PASSWORD for any
 * environment where a known default is not acceptable. Safe as a default only
 * because `must_change_password` forces it to be replaced at first login.
 */
const DEFAULT_SEED_PASSWORD = '123456';

async function main() {
  const password = process.env.METWORKCRM_SEED_PASSWORD || DEFAULT_SEED_PASSWORD;
  const db = createCrmDb();
  const email = SEED_EMAIL.trim().toLowerCase();

  const existing = await db
    .select({ id: internalUsers.id })
    .from(internalUsers)
    .where(eq(internalUsers.email, email));

  if (existing.length > 0) {
    console.log(`[crm:seed] ✓ ${email} already exists — nothing to do`);
    return;
  }

  const now = new Date().toISOString();
  await db.insert(internalUsers).values({
    id: randomUUID(),
    name: SEED_NAME,
    email,
    passwordHash: await hashPassword(password),
    role: 'ADMIN',
    mustChangePassword: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  });

  console.log(`[crm:seed] ✓ created ADMIN ${email}`);
  console.log('[crm:seed]   password: (from METWORKCRM_SEED_PASSWORD, else the dev default)');
  console.log('[crm:seed]   mustChangePassword=true — a change is forced at first login');
}

main().catch((err) => {
  console.error('[crm:seed] ✘ failed:', err);
  process.exit(1);
});
