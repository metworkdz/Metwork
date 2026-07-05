/**
 * 🏢 DOMICILIATION — the monthly price is mandatory.
 *
 * Server truth: POST /api/incubator/spaces rejects a DOMICILIATION listing
 * with a missing or zero pricePerMonth (validateDomiciliationPrice), and
 * accepts a positive one. The UI dialog carries the same guard — one pass
 * asserts the dedicated price input is present for the category.
 *
 * Fixture names carry the "Test " prefix per the cleanup convention; the
 * accepted space is deleted at the end of the spec.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { roleContext } from './api/_helpers';

let inc: APIRequestContext;
const TS = Date.now();

test.beforeAll(async () => {
  inc = await roleContext('incubator');
});

test.afterAll(async () => {
  await inc.dispose();
});

function domiciliationPayload(pricePerMonth: number | null | undefined) {
  return {
    name: `Test Domiciliation Price ${TS}`,
    description: 'Automated invoicing-suite fixture. Safe to delete.',
    category: 'DOMICILIATION',
    city: 'Alger',
    pricePerHour: null,
    pricePerDay: null,
    ...(pricePerMonth !== undefined ? { pricePerMonth } : {}),
    capacity: 1,
    amenities: [],
    acceptedPaymentMethods: ['ONLINE'],
    workingDays: [1, 2, 3, 4, 5],
    openingTime: '09:00',
    closingTime: '18:00',
    domiciliationSlots: 5,
  };
}

test('rejects a DOMICILIATION space with NO monthly price', async () => {
  const res = await inc.post('/api/incubator/spaces', { data: domiciliationPayload(undefined) });
  expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test('rejects a DOMICILIATION space with a 0 monthly price', async () => {
  const res = await inc.post('/api/incubator/spaces', { data: domiciliationPayload(0) });
  expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test('accepts a DOMICILIATION space with a positive monthly price (control)', async () => {
  const res = await inc.post('/api/incubator/spaces', { data: domiciliationPayload(2_500) });
  expect(res.status(), await res.text()).toBe(201);
  const space = await res.json() as { id: string; pricePerMonth: number };
  expect(space.pricePerMonth).toBe(2_500);

  // Clean up the fixture.
  const del = await inc.delete(`/api/incubator/spaces/${space.id}`);
  expect(del.ok()).toBeTruthy();
});

test('UI: the DOMICILIATION category exposes the mandatory price input', async ({ page }) => {
  await page.goto('/en/dashboard/incubator/spaces');
  await page
    .locator("button:has-text('Add space'), button:has-text('Ajouter un espace')")
    .first()
    .click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Pick the Domiciliation category.
  await dialog.locator('#s-category').click();
  await page
    .locator("[role='option']:has-text('Domiciliation')")
    .first()
    .click();

  // The dedicated monthly-price input (min=1) renders with the slots input.
  const price = dialog.locator('#s-dom-price');
  await expect(price).toBeVisible();
  await expect(price).toHaveAttribute('min', '1');
  await expect(dialog.locator('#s-slots')).toBeVisible();
});
