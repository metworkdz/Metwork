/**
 * The Facturation tab exists in the consultant portal at phone size.
 *
 * Written because the tab could not be found on a phone, and "it is in the
 * code" is not proof that it is reachable. This drives the real portal at
 * iPhone 13 metrics and asserts the whole path a consultant actually walks:
 * the bottom bar does NOT carry Facturation, the "Plus" sheet does, tapping it
 * opens the invoicing section, and that section is the real one (its three
 * views and the letterhead gate), not an empty shell.
 *
 * It also writes a JPEG of each step, so the result can be looked at rather
 * than taken on trust.
 *
 * Run against the local dev server with a minted consultant session:
 *
 *   USE_LOCAL_DB=true npx next dev                     # terminal 1
 *   CONSULTANT_SESSION=<metwork_consultant cookie> \
 *     npx playwright test --project=consultant-invoices-mobile
 */
import { test, expect, devices, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Full 390 × 844 screen — see consultant-demo-shots.spec.ts for why. */
test.use({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, browserName: 'chromium' });

const SESSION = process.env.CONSULTANT_SESSION ?? '';
const OUT = process.env.SHOTS_DIR ?? 'tests/screenshots/consultant-invoices';

/** Scoped so bottom-bar labels never collide with the hidden lg: sidebar. */
const bottomBar = (page: Page) => page.locator('nav.fixed').last();

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

test('a consultant reaches Facturation from the phone bottom bar', async ({ page, context }) => {
  expect(SESSION, 'CONSULTANT_SESSION must hold the metwork_consultant cookie value').not.toBe('');
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (f: string) => page.screenshot({ path: path.join(OUT, f), type: 'jpeg', quality: 92 });

  await context.addCookies([
    { name: 'metwork_consultant', value: SESSION, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
    { name: 'metwork_consultant_locale', value: 'fr', domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);

  await page.goto('/mentordashboard');
  await expect(bottomBar(page).getByRole('button', { name: 'Consultations' })).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot('01-bottom-bar.jpg');

  // The bar carries four primary tabs plus "Plus" — Facturation is NOT one of
  // them, which is exactly why it was not found. Asserted, not assumed: if the
  // tab is ever promoted, this line fails and says so.
  await expect(bottomBar(page).getByRole('button', { name: 'Facturation' })).toHaveCount(0);
  await expect(bottomBar(page).getByRole('button', { name: 'Plus' })).toBeVisible();

  // Where it actually lives.
  await bottomBar(page).getByRole('button', { name: 'Plus' }).click();
  // The sheet animates in. `toBeVisible` would pass mid-slide — and, worse, it
  // passes for an element that is on the page but BELOW the fold, which is
  // exactly the failure mode this test exists to rule out.
  await page.waitForTimeout(1200);
  const sheetItem = page.locator('.grid.grid-cols-3').getByRole('button', { name: 'Facturation' });
  await expect(sheetItem).toBeVisible();

  // The real assertion: the tap target lies inside the 390 x 844 screen, so a
  // thumb can reach it without scrolling a sheet that does not scroll.
  const box = await sheetItem.boundingBox();
  expect(box, 'Facturation must have a laid-out box').not.toBeNull();
  expect(box!.y + box!.height, 'Facturation is cut off below the fold').toBeLessThanOrEqual(844);
  expect(box!.height, 'Facturation must be a real tap target').toBeGreaterThanOrEqual(44);
  await shot('02-plus-sheet.jpg');

  await sheetItem.click();
  await settle(page);

  // The real section, not an empty tab: its heading, its subtitle, and the
  // three document kinds it can issue.
  const main = page.locator('main');
  await expect(main.getByText('Vos factures, factures proforma et devis.')).toBeVisible();
  for (const kind of ['Factures', 'Clients', 'Informations légales']) {
    await expect(main.getByText(kind, { exact: false }).first()).toBeVisible();
  }
  await shot('03-facturation.jpg');

  // The letterhead gate is the first thing a new consultant meets, and it is
  // what makes the tab useful rather than a dead end.
  await main.getByText('Informations légales', { exact: false }).first().click();
  await settle(page);
  await shot('04-informations-legales.jpg');

  for (const f of ['01-bottom-bar.jpg', '02-plus-sheet.jpg', '03-facturation.jpg', '04-informations-legales.jpg']) {
    expect(fs.statSync(path.join(OUT, f)).size, `${f} should not be a blank frame`).toBeGreaterThan(10_000);
  }
});
