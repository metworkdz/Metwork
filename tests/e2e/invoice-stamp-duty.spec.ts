/**
 * 🧾 INVOICE — droit de timbre brackets, including BOTH boundaries.
 *
 * The math cases run through the real POST /api/incubator/invoices (the same
 * engine the PDF freezes) with VAT 0 so the TTC is controlled to the dinar:
 *   TTC ≤ 30 000   → 1 %      (boundary 30 000 stays at 1 %)
 *   TTC ≤ 100 000  → 1.5 %    (boundary 100 000 stays at 1.5 %)
 *   TTC > 100 000  → 2 %
 * Non-ESPECE is asserted at 0 elsewhere (company/individual suites); here one
 * UI pass proves the "Droit de timbre" row APPEARS for Espèce.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { roleContext } from './api/_helpers';
import { createInvoiceApi, ensureIssuerLegal } from './api/_invoice-helpers';

let inc: APIRequestContext;

test.beforeAll(async () => {
  inc = await roleContext('incubator');
  await ensureIssuerLegal(inc);
});

test.afterAll(async () => {
  await inc.dispose();
});

const CASES: Array<{ ttc: number; timbre: number; label: string }> = [
  { ttc: 10_000,  timbre: 100,   label: '1% mid-bracket' },
  { ttc: 30_000,  timbre: 300,   label: '1% at the 30 000 boundary' },
  { ttc: 30_001,  timbre: 450,   label: '1.5% just above 30 000' },
  { ttc: 60_000,  timbre: 900,   label: '1.5% mid-bracket' },
  { ttc: 100_000, timbre: 1_500, label: '1.5% at the 100 000 boundary' },
  { ttc: 100_001, timbre: 2_000, label: '2% just above 100 000' },
  { ttc: 250_000, timbre: 5_000, label: '2% mid-bracket' },
];

for (const { ttc, timbre, label } of CASES) {
  test(`Espèce TTC ${ttc} → timbre ${timbre} (${label})`, async () => {
    const invoice = await createInvoiceApi(inc, {
      lines: [{ designation: `Timbre case ${ttc}`, quantity: 1, unitPriceHt: ttc }],
      vatRate: 0, // TTC === HT → the bracket input is exact
      paymentMethod: 'ESPECE',
    });
    expect(invoice.totals.ttc).toBe(ttc);
    expect(invoice.totals.timbre).toBe(timbre);
    // Net à Payer includes the timbre.
    expect(invoice.totals.net).toBe(ttc + timbre);
  });
}

test('UI: the Droit de timbre row appears when Espèce is selected', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/invoices/new');
  await expect(
    page.locator("h1:has-text('New invoice'), h1:has-text('Nouvelle facture')"),
  ).toBeVisible({ timeout: 60_000 });

  const designation = page.locator('input[list="invoice-service-names"]').first();
  await designation.fill('Timbre UI check');
  await designation.locator('xpath=following-sibling::input[@type="number"][1]').fill('1');
  await designation.locator('xpath=following-sibling::input[@type="number"][2]').fill('10000');
  await page.locator('#inv-vat').fill('0');

  // Espèce is the default payment method.
  const timbreRow = page.locator('dt', { hasText: /Stamp duty|Droit de timbre/ });
  await expect(timbreRow).toBeVisible();
  // 1% of 10 000 (NBSP-tolerant match).
  await expect(page.locator('main')).toContainText(/100,00[\s ]DA/);
});
