/**
 * 🧾 INVOICE — settings drive the create form.
 *
 * defaultVatRate + invoiceTemplate saved in settings must be exactly what the
 * /invoices/new form pre-fills. Defaults are restored afterwards so other
 * suites (which expect VAT 19 / CLASSIC) stay deterministic.
 */
import { test, expect } from '@playwright/test';
import { roleContext } from './api/_helpers';
import { ensureIssuerLegal, setInvoiceDefaults } from './api/_invoice-helpers';

test.beforeAll(async () => {
  const inc = await roleContext('incubator');
  try {
    await ensureIssuerLegal(inc);
    await setInvoiceDefaults(inc, { defaultVatRate: 9, invoiceTemplate: 'GREEN_BAND' });
  } finally {
    await inc.dispose();
  }
});

test.afterAll(async () => {
  const inc = await roleContext('incubator');
  try {
    await setInvoiceDefaults(inc, { defaultVatRate: 19, invoiceTemplate: 'CLASSIC' });
  } finally {
    await inc.dispose();
  }
});

test('defaultVatRate 9 + GREEN_BAND prefill the create form', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/invoices/new');
  await expect(
    page.locator("h1:has-text('New invoice'), h1:has-text('Nouvelle facture')"),
  ).toBeVisible({ timeout: 60_000 });

  await expect(page.locator('#inv-vat')).toHaveValue('9');

  // Template select (second combobox: payment method, template).
  const templateSelect = page.locator('button[role="combobox"]').nth(1);
  await expect(templateSelect).toContainText(/Green band|Bandeau vert/);
});
