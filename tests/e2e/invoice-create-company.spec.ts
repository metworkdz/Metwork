/**
 * 🧾 INVOICE — create for an ENTREPRISE client through the real UI.
 *
 * Flow: new-client dialog (full legal fields) → auto-selected with legal
 * preview → 2 lines → VAT 19 → Virement bancaire → live summary shows the
 * engine totals with NO "Droit de timbre" row → issue → PDF downloads.
 *
 * Project: invoices (serial, --workers=1). UI runs at /en/ for stable copy,
 * locators carry FR fallbacks per repo convention.
 */
import { test, expect, type Page } from '@playwright/test';
import { roleContext } from './api/_helpers';
import { ensureIssuerLegal, setInvoiceDefaults } from './api/_invoice-helpers';

const TS = Date.now();
const LEGAL_NAME = `Test SARL Company ${TS}`;

/** Normalized (NBSP → space) text of the live summary card. */
async function summaryText(page: Page): Promise<string> {
  const txt = await page.locator('main').innerText();
  return txt.replace(/ /g, ' ');
}

/** The qty / unit-price inputs are the designation input's following siblings. */
function rowInputs(page: Page, index: number) {
  const designation = page.locator('input[list="invoice-service-names"]').nth(index);
  return {
    designation,
    qty: designation.locator('xpath=following-sibling::input[@type="number"][1]'),
    price: designation.locator('xpath=following-sibling::input[@type="number"][2]'),
  };
}

test.beforeAll(async () => {
  const inc = await roleContext('incubator');
  try {
    await ensureIssuerLegal(inc);
    await setInvoiceDefaults(inc, { defaultVatRate: 19, invoiceTemplate: 'CLASSIC' });
  } finally {
    await inc.dispose();
  }
});

test('entreprise invoice: dialog client + 2 lines + Virement → totals, no timbre, PDF', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/invoices/new');
  await expect(
    page.locator("h1:has-text('New invoice'), h1:has-text('Nouvelle facture')"),
  ).toBeVisible({ timeout: 60_000 });

  // ── New client (Entreprise) with the full legal block ──
  await page
    .locator("button:has-text('New client'), button:has-text('Nouveau client')")
    .first()
    .click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Entreprise is the default toggle — assert then keep it.
  await expect(
    dialog.locator("button:has-text('Company'), button:has-text('Entreprise')").first(),
  ).toBeVisible();

  await dialog.locator('#c-legal').fill(LEGAL_NAME);
  await dialog.locator('#c-name').fill('Karim QA');
  await dialog.locator('#c-address').fill('Zone industrielle, Oran');
  await dialog.locator('#c-rc').fill('31/00-9999999B26');
  await dialog.locator('#c-nif').fill('002031112325396');
  await dialog.locator('#c-nis').fill('002031112325390');
  await dialog.locator('#c-ai').fill('31125282109');
  await dialog.locator('#c-phone').fill('0770 30 09 70');
  await dialog
    .locator("button[type='submit']:has-text('Create client'), button[type='submit']:has-text('Créer le client')")
    .click();
  await expect(dialog).toBeHidden();

  // Auto-selected client → read-only legal preview.
  const main = page.locator('main');
  await expect(main).toContainText(LEGAL_NAME);
  await expect(main).toContainText('RC: 31/00-9999999B26');
  await expect(main).toContainText('NIF: 002031112325396');

  // ── Two service lines: 2 × 10 000 + 1 × 4 000 = 24 000 HT ──
  const row1 = rowInputs(page, 0);
  await row1.designation.fill('Coworking — pack mensuel');
  await row1.qty.fill('2');
  await row1.price.fill('10000');

  await page
    .locator("button:has-text('Add a line'), button:has-text('Ajouter une ligne')")
    .click();
  await expect(page.locator('input[list="invoice-service-names"]')).toHaveCount(2);
  const row2 = rowInputs(page, 1);
  await row2.designation.fill('Domiciliation commerciale');
  await row2.qty.fill('1');
  await row2.price.fill('4000');

  // VAT prefilled at 19 from settings.
  await expect(page.locator('#inv-vat')).toHaveValue('19');

  // ── Default Espèce shows the timbre row… ──
  // Scoped to the summary's <dt> terms — a bare `text=` can match hidden
  // framework nodes and false-fail the absence check.
  const timbreTerm = page.locator('dt', { hasText: /Stamp duty|Droit de timbre/ });
  await expect(timbreTerm).toBeVisible();

  // ── …switching to Virement hides it. ──
  await page.locator('button[role="combobox"]').first().click();
  await page
    .locator("[role='option']:has-text('Bank transfer'), [role='option']:has-text('Virement bancaire')")
    .first()
    .click();
  await expect(timbreTerm).toHaveCount(0);

  // ── Engine totals in the live summary ──
  const summary = await summaryText(page);
  expect(summary).toContain('24 000,00 DA'); // Total HT
  expect(summary).toContain('4 560,00 DA'); // TVA 19%
  expect(summary).toContain('28 560,00 DA'); // TTC = Net (no timbre for Virement)
  expect(summary).toContain('VINGT HUIT MILLE CINQ CENT SOIXANTE DINARS');

  // ── Issue ──
  await page
    .locator("button[type='submit']:has-text('Issue the invoice'), button[type='submit']:has-text('Émettre la facture')")
    .click();
  await expect(
    page.locator("text=/Invoice .+ issued|Facture .+ émise/").first(),
  ).toBeVisible({ timeout: 20_000 });

  // ── PDF downloads through the real link ──
  const pdfLink = page
    .locator("a:has-text('Download the PDF'), a:has-text('Télécharger le PDF')")
    .first();
  const href = await pdfLink.getAttribute('href');
  expect(href).toMatch(/\/api\/incubator\/invoices\/.+\/pdf$/);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  const body = await res.body();
  expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
