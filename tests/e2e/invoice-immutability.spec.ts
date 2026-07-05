/**
 * 🧾 INVOICE — legal immutability.
 *
 * The only allowed transition is status → CANCELLED (idempotent). Everything
 * else is refused or ignored: status ISSUED is rejected by the Zod literal,
 * and smuggled field "edits" on the PATCH are stripped — the stored lines,
 * totals, number and snapshots stay byte-identical. The list UI shows the
 * Annulée / Cancelled badge.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { roleContext } from './api/_helpers';
import { createInvoiceApi, ensureIssuerLegal, getInvoiceApi, type InvoiceView } from './api/_invoice-helpers';

let inc: APIRequestContext;
let invoice: InvoiceView;

test.beforeAll(async () => {
  inc = await roleContext('incubator');
  await ensureIssuerLegal(inc);
  invoice = await createInvoiceApi(inc, {
    lines: [{ designation: 'Immutability fixture', quantity: 3, unitPriceHt: 7_000 }],
    vatRate: 19,
    paymentMethod: 'ESPECE',
  });
});

test.afterAll(async () => {
  await inc.dispose();
});

test('cancel: PATCH status CANCELLED → 200, status flips, and is idempotent', async () => {
  const res = await inc.patch(`/api/incubator/invoices/${invoice.id}`, {
    data: { status: 'CANCELLED' },
  });
  expect(res.status()).toBe(200);
  const { invoice: cancelled } = await res.json() as { invoice: InvoiceView };
  expect(cancelled.status).toBe('CANCELLED');

  // Idempotent second cancel.
  const again = await inc.patch(`/api/incubator/invoices/${invoice.id}`, {
    data: { status: 'CANCELLED' },
  });
  expect(again.status()).toBe(200);
});

test('no other transition: PATCH status ISSUED is rejected', async () => {
  const res = await inc.patch(`/api/incubator/invoices/${invoice.id}`, {
    data: { status: 'ISSUED' },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);

  const after = await getInvoiceApi(inc, invoice.id);
  expect(after.status).toBe('CANCELLED');
});

test('no field edits: smuggled changes on PATCH are ignored, record unchanged', async () => {
  const before = await getInvoiceApi(inc, invoice.id);

  const res = await inc.patch(`/api/incubator/invoices/${invoice.id}`, {
    data: {
      status: 'CANCELLED',
      // Attempted tampering — all of these must be dropped.
      vatRate: 1,
      lines: [{ designation: 'hacked', quantity: 1, unitPriceHt: 1 }],
      totals: { ht: 1, tva: 0, ttc: 1, timbre: 0, net: 1 },
      number: '99/2099',
      amountInWords: 'UN DINAR',
    },
  });
  expect(res.status()).toBe(200);

  const after = await getInvoiceApi(inc, invoice.id);
  expect(after.vatRate).toBe(before.vatRate);
  expect(after.lines).toEqual(before.lines);
  expect(after.totals).toEqual(before.totals);
  expect(after.number).toBe(before.number);
  expect(after.amountInWords).toBe(before.amountInWords);
  expect(after.clientSnapshot).toEqual(before.clientSnapshot);
  expect(after.issuerSnapshot).toEqual(before.issuerSnapshot);
});

test('UI: the invoices list shows the cancelled badge for this number', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/invoices');
  // The Factures tab is the default. Match the NUMBER CELL exactly — a plain
  // row substring match could collide with a date like "05/07/2026".
  const row = page
    .locator('tr', { has: page.getByRole('cell', { name: invoice.number, exact: true }) })
    .first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(
    row.locator("text=Cancelled").or(row.locator("text=Annulée")).first(),
  ).toBeVisible();
});
