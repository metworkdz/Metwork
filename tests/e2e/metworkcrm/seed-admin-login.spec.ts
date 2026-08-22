/**
 * METWORK OS CRM — verifies the documented seed credential actually works:
 * mohamed@metwork.dz / 123456 (SESSION_LOG.md, every prior prompt's manual
 * verification section).
 *
 * This is DELIBERATELY separate from `crm-critical-paths.spec.ts`, which
 * never touches the seed account (a login spec running against it would flip
 * `must_change_password` and only pass once). This file exists specifically
 * to prove the real documented credential authenticates — so it has to touch
 * the real account, and therefore has to restore it byte-for-byte afterwards.
 *
 * `afterAll` reads the account's state BEFORE touching it and writes that
 * exact state back, rather than assuming what it "should" be — so this test
 * stays correct even if the documented password or flag ever changes.
 *
 * `hashPassword` is imported from the application, not reimplemented — see
 * `_crm-fixtures.ts` for why.
 */
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { hashPassword } from '../../../src/server/auth/password';

const SEED_EMAIL = 'mohamed@metwork.dz';
const SEED_PASSWORD = '123456';
const BASE = process.env.CRM_E2E_BASE_URL ?? 'http://localhost:3999';
const CRM_DB_PATH = (process.env.METWORKCRM_DATABASE_URL ?? 'file:.crm-local.db').replace(/^file:/, '');

interface SeedAdminState {
  id: string;
  passwordHash: string;
  mustChangePassword: number;
}

function readSeedAdminState(): SeedAdminState | null {
  const db = new Database(CRM_DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare('SELECT id, password_hash AS passwordHash, must_change_password AS mustChangePassword FROM internal_users WHERE email = ?')
      .get(SEED_EMAIL) as SeedAdminState | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** Write the account back to exactly the state it was in before this spec ran. */
function restoreSeedAdminState(state: SeedAdminState): void {
  const db = new Database(CRM_DB_PATH);
  try {
    db.prepare('UPDATE internal_users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?').run(
      state.passwordHash,
      state.mustChangePassword,
      new Date().toISOString(),
      state.id,
    );
    // Any session this spec created is invalidated by the password change
    // anyway, but clear it explicitly rather than relying on that.
    db.prepare('DELETE FROM crm_sessions WHERE user_id = ?').run(state.id);
  } finally {
    db.close();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('seed admin credential — mohamed@metwork.dz / 123456', () => {
  let before: SeedAdminState;

  test.beforeAll(() => {
    const state = readSeedAdminState();
    expect(state, 'the documented seed admin account must exist in the CRM database').toBeTruthy();
    before = state!;
  });

  test.afterAll(() => {
    if (before) restoreSeedAdminState(before);
  });

  test('authenticates at the API level with the documented password', async ({ request }) => {
    // Proves the credential itself, independent of any UI behavior — a wrong
    // password or a locked/inactive account fails here with 401 regardless
    // of what the login page does.
    const res = await request.post(`${BASE}/api/metworkcrm/auth/login`, {
      data: { email: SEED_EMAIL, password: SEED_PASSWORD },
    });
    expect(res.status(), 'mohamed@metwork.dz / 123456 must authenticate').toBe(200);
    const body = await res.json();
    expect(body.next).toBeTruthy();
  });

  test('rejects the correct email with a wrong password (the credential is not accidentally accept-anything)', async ({ request }) => {
    const res = await request.post(`${BASE}/api/metworkcrm/auth/login`, {
      data: { email: SEED_EMAIL, password: 'definitely-wrong-password' },
    });
    expect(res.status()).toBe(401);
  });

  test('logs in through the real UI and reaches the CRM dashboard', async ({ page }) => {
    await page.goto('/metworkcrm/login');
    await page.getByLabel(/Adresse e-mail/i).fill(SEED_EMAIL);
    await page.getByLabel(/Mot de passe/i).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: /Se connecter/i }).click();

    if (before.mustChangePassword) {
      // Documented seed state (SESSION_LOG.md): forces a change before first
      // use. Complete it with a throwaway password so the test proves the
      // account can actually REACH the CRM, not just authenticate — the two
      // are different claims, and this spec's whole point is the login
      // information working end to end.
      await expect(page, 'must land on the forced password-change screen').toHaveURL(
        /\/metworkcrm\/change-password/,
        { timeout: 90_000 },
      );
      await expect(page.getByText(SEED_EMAIL)).toBeVisible();

      await page.getByLabel(/Mot de passe actuel/i).fill(SEED_PASSWORD);
      await page.getByLabel(/^Nouveau mot de passe/i).fill('TempE2eVerify!2026');
      await page.getByLabel(/Confirmer/i).fill('TempE2eVerify!2026');
      await page.getByRole('button', { name: /Mettre à jour/i }).click();
    }

    await expect(page, 'must reach the CRM dashboard').toHaveURL(/\/metworkcrm(\?|$)/, { timeout: 90_000 });
    await expect(page.getByRole('heading', { name: /Bonjour/i })).toBeVisible({ timeout: 30_000 });
  });
});
