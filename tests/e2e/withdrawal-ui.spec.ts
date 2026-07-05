/**
 * UI e2e — the requester withdraw flow on the wallet page + a hydration guard
 * on the pages this feature touched.
 *
 * Project: withdrawals-ui (playwright.config.ts). Default storageState = the
 * entrepreneur `builder` account (its own wallet page, and NOT touched by the
 * api withdrawal spec, so its payout account stays clean).
 *
 * PRECONDITION: a freshly-seeded local DB — `builder` must start with NO payout
 * account so assertion 1 (prompt to add one before withdrawing) holds. This
 * mirrors the fresh-seed assumption of the other stateful UI suites.
 *
 * UI runs at /en/ for stable copy; the RTL hydration check uses /ar/.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { authStatePath } from './global-setup';

const WALLET_EN = '/en/dashboard/entrepreneur/wallet';
const VALID_RIB = '00799999000123456789';

/** Wait for the wallet card + its "Withdraw money" trigger (enabled once loaded). */
async function openWithdrawDialog(page: Page) {
  await page.goto(WALLET_EN);
  const trigger = page.getByRole('button', { name: 'Withdraw money' });
  await expect(trigger).toBeEnabled({ timeout: 60_000 });
  await trigger.click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Wallet withdraw — payout account gate', () => {
  test('with no account, Withdraw money prompts to add a payout account first', async ({ page }) => {
    await page.goto(WALLET_EN);
    // The summary row itself advertises the missing account.
    await expect(page.getByText('No payout account yet', { exact: false })).toBeVisible({ timeout: 60_000 });

    const dialog = await openWithdrawDialog(page);
    // The dialog opens on the ADD-ACCOUNT step, not the withdraw form.
    await expect(dialog.getByText('Add payout account')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save account' })).toBeVisible();
    // No amount field yet — you can't withdraw before adding an account.
    await expect(dialog.locator('#wd-amount')).toHaveCount(0);
  });

  test('account form: Bank→RIB / CCP→RIP labels, invalid number rejected, valid saves and advances', async ({ page }) => {
    const dialog = await openWithdrawDialog(page);
    await expect(dialog.getByText('Add payout account')).toBeVisible();

    // Bank is the default type → the number field is labelled RIB.
    await expect(dialog.getByText('RIB (20 digits)')).toBeVisible();

    // Switching to CCP relabels the field RIP.
    await dialog.getByRole('radio', { name: 'CCP' }).click();
    await expect(dialog.getByText('RIP (20 digits)')).toBeVisible();

    // Back to Bank for the save path.
    await dialog.getByRole('radio', { name: 'Bank' }).click();
    await expect(dialog.getByText('RIB (20 digits)')).toBeVisible();

    const save = dialog.getByRole('button', { name: 'Save account' });
    await dialog.locator('#pa-holder').fill('QA Builder');

    // An invalid (too-short) number shows the error and keeps Save disabled.
    await dialog.locator('#pa-number').fill('12345');
    await expect(dialog.getByText('Enter a valid 20-digit number.')).toBeVisible();
    await expect(save).toBeDisabled();

    // A valid 20-digit RIB clears the error and enables Save.
    await dialog.locator('#pa-number').fill(VALID_RIB);
    await expect(dialog.getByText('Enter a valid 20-digit number.')).toHaveCount(0);
    await expect(save).toBeEnabled();

    await save.click();

    // Saving advances to the withdraw step (available balance + method radios),
    // with the bank_transfer method available (matches the saved bank account).
    await expect(dialog.getByText('Available balance:', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Bank transfer' })).toBeVisible();
  });
});

/* ───────────────────────────── Hydration guard (assertion 10) ─────────────────────────────
 * Navigate the pages this feature touched and assert no React hydration
 * mismatch / client error. Both LTR (/en) and RTL (/ar) wallet renders are
 * checked; the admin payments page is checked with the admin session. */

const HYDRATION_MARKERS = ['hydrat', 'did not match', 'text content does not match', 'server html'];

function attachErrorCollectors(page: Page): { hydration: string[]; pageErrors: string[] } {
  const hydration: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text().toLowerCase();
    if (HYDRATION_MARKERS.some((m) => text.includes(m))) hydration.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { hydration, pageErrors };
}

test.describe('No hydration warnings on touched pages', () => {
  for (const path of [WALLET_EN, '/ar/dashboard/entrepreneur/wallet']) {
    test(`wallet renders clean — ${path}`, async ({ page }) => {
      const errs = attachErrorCollectors(page);
      await page.goto(path);
      await expect(page.getByRole('button', { name: /Withdraw money|Retirer de l.argent|سحب الأموال/ }))
        .toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500); // let any hydration mismatch surface
      expect(errs.hydration, `hydration errors: ${errs.hydration.join(' | ')}`).toHaveLength(0);
      expect(errs.pageErrors, `page errors: ${errs.pageErrors.join(' | ')}`).toHaveLength(0);
    });
  }
});

test.describe('No hydration warnings — admin payments', () => {
  test.use({ storageState: authStatePath('admin') });

  test('admin payments page renders clean', async ({ page }) => {
    const errs = attachErrorCollectors(page);
    await page.goto('/en/dashboard/admin/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    expect(errs.hydration, `hydration errors: ${errs.hydration.join(' | ')}`).toHaveLength(0);
    expect(errs.pageErrors, `page errors: ${errs.pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
