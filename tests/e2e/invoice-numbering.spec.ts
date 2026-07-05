/**
 * 🧾 INVOICE — sequential NN/YYYY numbering with no gaps.
 *
 * The local DB persists between runs, so the assertion is RELATIVE: two
 * back-to-back creations yield seq n then n+1 in the same year, both
 * rendered zero-padded as "NN/YYYY".
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

const NUMBER_RE = /^(\d{2,})\/(\d{4})$/;

test('two invoices in a row get consecutive numbers, no gap', async () => {
  const first = await createInvoiceApi(inc, {
    lines: [{ designation: 'Numbering A', quantity: 1, unitPriceHt: 1_000 }],
    paymentMethod: 'CHEQUE',
  });
  const second = await createInvoiceApi(inc, {
    lines: [{ designation: 'Numbering B', quantity: 1, unitPriceHt: 1_000 }],
    paymentMethod: 'CHEQUE',
  });

  const m1 = first.number.match(NUMBER_RE);
  const m2 = second.number.match(NUMBER_RE);
  expect(m1, `unexpected number format: ${first.number}`).not.toBeNull();
  expect(m2, `unexpected number format: ${second.number}`).not.toBeNull();

  const [seq1, year1] = [Number(m1![1]), Number(m1![2])];
  const [seq2, year2] = [Number(m2![1]), Number(m2![2])];

  // Same (current) year, strictly consecutive — no gap, no collision.
  expect(year1).toBe(new Date().getUTCFullYear());
  expect(year2).toBe(year1);
  expect(seq2).toBe(seq1 + 1);

  // The stored seq/year mirror the display number.
  expect(first.seq).toBe(seq1);
  expect(second.seq).toBe(seq2);
  expect(first.year).toBe(year1);

  // Zero-padding: always at least two digits.
  expect(m1![1]!.length).toBeGreaterThanOrEqual(2);
  expect(m2![1]!.length).toBeGreaterThanOrEqual(2);
});
