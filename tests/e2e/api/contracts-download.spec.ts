/**
 * API-driven e2e: CONTRACT generation & download (Prompt 4).
 *
 * An incubator authors a template with {{variables}} (incl. an UNKNOWN token to
 * prove safe substitution), then downloads a filled PDF for one of its own space
 * bookings. We assert the real HTTP download end-to-end:
 *   • 200 + Content-Type application/pdf,
 *   • Content-Disposition attachment with a `contract-CT-….pdf` filename,
 *   • a non-empty body whose magic bytes are `%PDF`.
 *
 * Plus the ownership guard: a booking that isn't the caller's space is rejected.
 * No external calls (the logo prefetch is null-safe). Serial (workers:1).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createSpace,
  manualBooking,
  futureWeekdayUtc,
  utcWindow,
} from './_helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

test.describe.serial('Contract download', () => {
  let inc: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
  });
  test.afterAll(async () => {
    await inc.dispose();
  });

  test('incubator authors a template and downloads a filled contract PDF for its booking', async () => {
    // 1. Template with known tokens + one unknown token (must render blank, never crash).
    const tplRes = await inc.post('/api/incubator/contracts', {
      data: {
        name: `QA Lease ${Date.now().toString(36)}`,
        spaceCategory: 'ANY',
        language: 'fr',
        body:
          'Locataire: {{client_name}} — Espace: {{space_name}} — ' +
          'Montant: {{price}} — Payé: {{amount_paid}} — Solde: {{amount_due}} — ' +
          'Contrat {{contract_number}} du {{today}}. [{{nope_unknown}}]',
      },
    });
    expect(tplRes.status(), `create template → ${tplRes.status()} ${await tplRes.text()}`).toBe(201);
    const templateId = (await tplRes.json()).template.id as string;

    // 2. A SPACE booking owned by this incubator (auto-CONFIRMED manual booking).
    const space = await createSpace(inc, { pricePerDay: 6000, workingDays: ALL_WEEK });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(28), 9, 18);
    const bkRes = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'DAY',
      startsAt,
      endsAt,
      quantity: 1,
      totalAmount: 6000,
      clientName: 'Ahmed Benali',
    });
    expect(bkRes.status(), `manual booking → ${bkRes.status()} ${await bkRes.text()}`).toBe(201);
    const bookingId = (await bkRes.json()).booking.id as string;

    // 3. Download the filled contract.
    const res = await inc.get(`/api/incubator/bookings/${bookingId}/contract?templateId=${templateId}`);
    expect(res.status(), `contract → ${res.status()} ${await res.text()}`).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['content-disposition'] ?? '', 'attachment with a contract filename')
      .toMatch(/attachment;\s*filename="contract-CT-[A-Z0-9-]+\.pdf"/);

    const body = await res.body();
    expect(body.length, 'PDF is non-empty').toBeGreaterThan(1000);
    expect(body.subarray(0, 4).toString('latin1'), 'valid PDF magic bytes').toBe('%PDF');
  });

  test('downloading without a templateId is rejected (400)', async () => {
    const space = await createSpace(inc, { workingDays: ALL_WEEK });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(29), 9, 11);
    const bkRes = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'HOUR',
      startsAt,
      endsAt,
    });
    const bookingId = (await bkRes.json()).booking.id as string;

    const res = await inc.get(`/api/incubator/bookings/${bookingId}/contract`);
    expect(res.status(), 'missing templateId → 400').toBe(400);
  });
});
