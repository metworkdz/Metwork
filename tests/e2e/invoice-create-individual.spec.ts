/**
 * 🧾 INVOICE — create for a PERSONNE PHYSIQUE client through the real UI.
 *
 * The client dialog is toggled to "Individual": no legal identifiers are
 * asked or shown; the invoice stores clientType INDIVIDUAL with a phone-only
 * contact block. Chèque payment ⇒ no timbre row.
 */
import { test, expect } from '@playwright/test';
import { roleContext } from './api/_helpers';
import { ensureIssuerLegal, getInvoiceApi, setInvoiceDefaults } from './api/_invoice-helpers';

const TS = Date.now();
const PERSON = `Test Personne ${TS}`;

test.beforeAll(async () => {
  const inc = await roleContext('incubator');
  try {
    await ensureIssuerLegal(inc);
    await setInvoiceDefaults(inc, { defaultVatRate: 19, invoiceTemplate: 'CLASSIC' });
  } finally {
    await inc.dispose();
  }
});

test('personne physique invoice: Chèque → no timbre, INDIVIDUAL client block', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/invoices/new');
  await expect(
    page.locator("h1:has-text('New invoice'), h1:has-text('Nouvelle facture')"),
  ).toBeVisible({ timeout: 60_000 });

  // ── New client, toggled to Personne physique ──
  await page
    .locator("button:has-text('New client'), button:has-text('Nouveau client')")
    .first()
    .click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  await dialog
    .locator("button:has-text('Individual'), button:has-text('Personne physique')")
    .first()
    .click();
  // Legal-identifier inputs disappear for individuals.
  await expect(dialog.locator('#c-legal')).toHaveCount(0);
  await expect(dialog.locator('#c-rc')).toHaveCount(0);

  await dialog.locator('#c-name').fill(PERSON);
  await dialog.locator('#c-address').fill('Hydra, Alger');
  await dialog.locator('#c-phone').fill('0550 11 22 33');
  await dialog
    .locator("button[type='submit']:has-text('Create client'), button[type='submit']:has-text('Créer le client')")
    .click();
  await expect(dialog).toBeHidden();

  // Preview: the individual badge + contact, and NO legal identifiers.
  const main = page.locator('main');
  await expect(main).toContainText(PERSON);
  await expect(
    main.locator("text=Individual").or(main.locator("text=Personne physique")).first(),
  ).toBeVisible();
  await expect(main).not.toContainText('RC:');
  await expect(main).not.toContainText('NIF:');

  // ── One line + Chèque ──
  const designation = page.locator('input[list="invoice-service-names"]').first();
  await designation.fill('Formation pitch');
  await designation.locator('xpath=following-sibling::input[@type="number"][1]').fill('1');
  await designation.locator('xpath=following-sibling::input[@type="number"][2]').fill('15000');

  await page.locator('button[role="combobox"]').first().click();
  await page
    .locator("[role='option']:has-text('Cheque'), [role='option']:has-text('Chèque')")
    .first()
    .click();
  // Scoped to the summary <dt> terms — bare `text=` can match hidden nodes.
  await expect(page.locator('dt', { hasText: /Stamp duty|Droit de timbre/ })).toHaveCount(0);

  // ── Issue and verify the stored snapshot via the API ──
  await page
    .locator("button[type='submit']:has-text('Issue the invoice'), button[type='submit']:has-text('Émettre la facture')")
    .click();
  await expect(
    page.locator("text=/Invoice .+ issued|Facture .+ émise/").first(),
  ).toBeVisible({ timeout: 20_000 });

  const href = await page
    .locator("a:has-text('Download the PDF'), a:has-text('Télécharger le PDF')")
    .first()
    .getAttribute('href');
  const invoiceId = href!.match(/invoices\/(.+)\/pdf$/)![1]!;

  const inc = await roleContext('incubator');
  try {
    const invoice = await getInvoiceApi(inc, invoiceId);
    expect(invoice.clientSnapshot.clientType).toBe('INDIVIDUAL');
    expect(invoice.clientSnapshot.name).toBe(PERSON);
    expect(invoice.clientSnapshot.legalName ?? null).toBeNull();
    expect(invoice.paymentMethod).toBe('CHEQUE');
    expect(invoice.totals.timbre).toBe(0);
    expect(invoice.totals.net).toBe(invoice.totals.ttc);
  } finally {
    await inc.dispose();
  }
});
