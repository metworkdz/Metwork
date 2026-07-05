/**
 * 🧾 INVOICE — the three PDF templates render.
 *
 * For each of CLASSIC / GREEN_BAND / MINIMAL: set it as the incubator default,
 * issue an invoice WITHOUT a per-invoice override (so the default is what
 * sticks), then download the PDF and assert a real document comes back.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { roleContext } from './api/_helpers';
import {
  createInvoiceApi, ensureIssuerLegal, fetchInvoicePdf, setInvoiceDefaults,
} from './api/_invoice-helpers';

let inc: APIRequestContext;

test.beforeAll(async () => {
  inc = await roleContext('incubator');
  await ensureIssuerLegal(inc);
});

test.afterAll(async () => {
  // Leave a sane default behind for the other suites / manual use.
  await setInvoiceDefaults(inc, { invoiceTemplate: 'CLASSIC' });
  await inc.dispose();
});

for (const template of ['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const) {
  test(`default template ${template} → invoice stores it and its PDF renders`, async () => {
    await setInvoiceDefaults(inc, { invoiceTemplate: template });

    const invoice = await createInvoiceApi(inc, {
      lines: [{ designation: `Template ${template}`, quantity: 1, unitPriceHt: 5_000 }],
      paymentMethod: 'VIREMENT',
      // no `template` override — must fall back to the incubator default
    });
    expect(invoice.template).toBe(template);

    await fetchInvoicePdf(inc, invoice); // 200 + application/pdf + %PDF + filename
  });
}
