/**
 * METWORK OS CRM — auth invariants.
 *
 * Covers the properties that must hold regardless of UI: password hashing,
 * session-token storage, the role gate, and the money-visibility rule.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { createCrmDb, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { internalUsers, crmSessions } from '@/server/metworkcrm/db/schema';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { canSeeMoney, redactMoney, ADMIN_ONLY_SEGMENTS } from '@/server/metworkcrm/auth/guards';
import { crmChangePasswordSchema, crmLoginSchema } from '@/server/metworkcrm/auth/schemas';

const MEM = 'file::memory:';
let db: CrmDatabase;
const NOW = '2026-08-20T10:00:00.000Z';

/**
 * Assert that a statement is refused. `db.run()`/`db.insert()` are SYNCHRONOUS
 * on better-sqlite3 and asynchronous on libSQL, so `.rejects` is wrong for the
 * file driver — the throw happens while evaluating the argument. Normalizes both.
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


beforeAll(async () => {
  db = createCrmDb(MEM);
  await runCrmMigrations(db, MEM);
});

describe('CRM password storage', () => {
  it('never stores the plaintext password', async () => {
    const hash = await hashPassword('123456');
    expect(hash).not.toContain('123456');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('123456', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different hash each time (per-password salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });
});

describe('CRM sessions', () => {
  it('stores only the SHA-256 of the session id, never the plaintext', async () => {
    await db.insert(internalUsers).values({
      id: 'u1',
      name: 'Mohamed',
      email: 'mohamed@metwork.dz',
      passwordHash: await hashPassword('123456'),
      role: 'ADMIN',
      mustChangePassword: true,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const plaintext = randomBytes(32).toString('base64url');
    const idHash = createHash('sha256').update(plaintext).digest('hex');
    await db.insert(crmSessions).values({
      idHash,
      userId: 'u1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: NOW,
    });

    const dump = await db.all<{ id_hash: string }>(sql`SELECT id_hash FROM crm_sessions`);
    expect(dump[0]?.id_hash).toBe(idHash);
    // The token itself must appear nowhere in the table.
    expect(JSON.stringify(dump)).not.toContain(plaintext);
  });

  it('cascades session deletion when the user is removed', async () => {
    await db.insert(internalUsers).values({
      id: 'u-temp',
      name: 'Temp',
      email: 'temp@metwork.dz',
      passwordHash: await hashPassword('x'),
      role: 'TEAM_MEMBER',
      mustChangePassword: false,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(crmSessions).values({
      idHash: 'hash-temp',
      userId: 'u-temp',
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: NOW,
    });

    await db.delete(internalUsers).where(eq(internalUsers.id, 'u-temp'));
    const left = await db.all(sql`SELECT 1 FROM crm_sessions WHERE user_id = 'u-temp'`);
    expect(left).toHaveLength(0);
  });

  it('rejects a duplicate email', async () => {
    await expectRefused(() =>
      db.insert(internalUsers).values({
        id: 'u2',
        name: 'Autre',
        email: 'mohamed@metwork.dz',
        passwordHash: 'x',
        role: 'ADMIN',
        mustChangePassword: false,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
  });

  it('rejects a role outside ADMIN / TEAM_MEMBER', async () => {
    await expectRefused(() =>
      db.run(sql`INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
                 VALUES ('u3', 'X', 'x@metwork.dz', 'h', 'SUPERUSER', 0, 1, ${NOW}, ${NOW})`),
    );
  });
});

describe('CRM role gate', () => {
  it('reserves settings, users and payments for ADMIN', () => {
    expect([...ADMIN_ONLY_SEGMENTS].sort()).toEqual(['payments', 'settings', 'users']);
  });

  it('lets only ADMIN see monetary figures (R-19)', () => {
    expect(canSeeMoney({ role: 'ADMIN' })).toBe(true);
    expect(canSeeMoney({ role: 'TEAM_MEMBER' })).toBe(false);
  });

  it('redacts amounts for TEAM_MEMBER but keeps non-monetary fields', () => {
    const row = { id: 'o1', title: 'Deal', stage: 'NEGOCIATION', amount: 250_000 };
    const forMember = redactMoney({ role: 'TEAM_MEMBER' }, row, ['amount']);
    expect(forMember.amount).toBeNull();
    expect(forMember.stage).toBe('NEGOCIATION');
    expect(forMember.title).toBe('Deal');

    const forAdmin = redactMoney({ role: 'ADMIN' }, row, ['amount']);
    expect(forAdmin.amount).toBe(250_000);
  });
});

describe('CRM auth validation', () => {
  it('normalizes the login email to lowercase', () => {
    const parsed = crmLoginSchema.parse({ email: '  Mohamed@Metwork.DZ ', password: 'x' });
    expect(parsed.email).toBe('mohamed@metwork.dz');
  });

  it('requires at least 8 characters for a chosen password', () => {
    const r = crmChangePasswordSchema.safeParse({
      currentPassword: '123456',
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(r.success).toBe(false);
  });

  it('requires the confirmation to match', () => {
    const r = crmChangePasswordSchema.safeParse({
      currentPassword: '123456',
      newPassword: 'a-good-password',
      confirmPassword: 'a-different-one',
    });
    expect(r.success).toBe(false);
  });

  it('refuses reusing the current password', () => {
    const r = crmChangePasswordSchema.safeParse({
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
      confirmPassword: 'same-password-1',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a valid change', () => {
    const r = crmChangePasswordSchema.safeParse({
      currentPassword: '123456',
      newPassword: 'un-mot-de-passe-solide',
      confirmPassword: 'un-mot-de-passe-solide',
    });
    expect(r.success).toBe(true);
  });
});
