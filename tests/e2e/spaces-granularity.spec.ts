/**
 * 🟢 SPACES-GRANULARITY — e2e for the category-specific space model
 * (COWORKING desks · PRIVATE_OFFICE · DOMICILIATION) and the manual-booking
 * desk-blocking + expiry-notifier features.
 *
 * SERIAL by design: every suite mutates the one shared JSON document, and later
 * suites depend on records created by earlier ones (Suite 4 reads Suite 1's
 * desks; Suite 8 reads Suite 3's domiciliation space). Run with --workers=1.
 *
 *   npx playwright test --project=spaces-granularity --workers=1
 *
 * Cleanup of every "Test …" artifact is a SEPARATE file:
 *   npx playwright test tests/cleanup/spaces-granularity.cleanup.ts
 *
 * UI flows use /en/ URLs so the UI renders in English (stable selectors). Public
 * pages are viewed through a fresh GUEST context — the desk picker / request
 * form only render for visitors, not the logged-in incubator.
 */
import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import {
  BASE,
  roleContext,
  createSpace,
  manualBooking,
} from './api/_helpers';

const TS = Date.now();

// Names are unique per run AND carry the "Test " prefix the cleanup filters on.
const NAME = {
  coworking:     `Test Coworking Space ${TS}`,
  office:        `Test Private Office ${TS}`,
  domiciliation: `Test Domiciliation ${TS}`,
  block:         `Test Coworking Block ${TS}`,
  conflict:      `Test Conflict Space ${TS}`,
  expiry:        `Test Expiry Space ${TS}`,
};

// Shared across the serial suites.
let coworkingSpaceId = '';
let domiciliationSpaceId = '';

/* ───────────────────────── local helpers ───────────────────────── */

/** Raw read of the server's source-of-truth JSON doc (USE_LOCAL_DB mode). */
function readRaw(): {
  spaces: Array<{ id: string; name: string; category: string; domiciliationSlots: number | null; incubatorId: string }>;
  deskBookings: Array<{ spaceId: string; deskName: string; bookingId: string | null; status: string }>;
  bookings: Array<{ id: string; itemId: string; clientName: string | null; clientPhone: string | null }>;
  domiciliationRequests: Array<{ spaceId: string; email: string; status: string }>;
} {
  const p = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    spaces: d.spaces ?? [],
    deskBookings: d.deskBookings ?? [],
    bookings: d.bookings ?? [],
    domiciliationRequests: d.domiciliationRequests ?? [],
  };
}

/** The CRON_SECRET the dev server was started with (read from .env.local). */
function cronSecret(): string {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^CRON_SECRET=(.*)$/m);
    if (m && m[1]) return m[1].trim();
  } catch { /* ignore */ }
  return '';
}

/** "YYYY-MM-DD" for today (local — matches the form/date-input default). */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** "YYYY-MM-DD" for today + n days (UTC). */
function dayUtc(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pick an option in a Radix <Select> identified by its trigger id. */
async function pickRadix(page: Page, triggerId: string, optionName: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

/** Resolve a space id by its (unique) name via the incubator API. */
async function spaceIdByName(inc: APIRequestContext, name: string): Promise<string> {
  const res = await inc.get('/api/incubator/spaces');
  expect(res.ok(), `list spaces → ${res.status()}`).toBeTruthy();
  const { items } = (await res.json()) as { items: Array<{ id: string; name: string }> };
  const found = items.find((s) => s.name === name);
  expect(found, `space "${name}" should exist`).toBeTruthy();
  return found!.id;
}

/** Create a CRM client (so the manual-booking dialog has someone to pick). */
async function createClient(inc: APIRequestContext, fullName: string, email: string): Promise<void> {
  const res = await inc.post('/api/incubator/clients', {
    data: { fullName, email, phone: '+213555123456' },
  });
  expect([200, 201]).toContain(res.status());
}

/** Open the incubator spaces page and the "Add space" dialog. */
async function openSpaceForm(page: Page) {
  await page.goto('/en/dashboard/incubator/spaces');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Add space' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Fresh guest page (no auth) for public surfaces. */
async function guestPage(browser: Browser): Promise<{ ctx: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  // Explicit empty storage state → a true logged-out visitor (the desk picker /
  // request form only render for guests + entrepreneurs, not the incubator).
  const ctx = await browser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  return { ctx, page: await ctx.newPage() };
}

/* ───────────────────────── suites ───────────────────────── */

test.describe.serial('🟢 Spaces granularity', () => {
  let inc: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
  });
  test.afterAll(async () => {
    await inc.dispose();
  });

  // ── SUITE 1 — Create coworking space with desks ────────────────────────────
  test('S1 — incubator creates a coworking space with 3 desks & blocks one', async ({ page }) => {
    await openSpaceForm(page);

    await page.locator('#s-name').fill(NAME.coworking);
    // Category defaults to COWORKING.
    await pickRadix(page, 's-city', 'Alger');
    await page.locator('#s-desc').fill('Automated e2e coworking fixture. Safe to delete.');
    await page.locator('#s-day').fill('500');

    // 3 desks, auto-generate, then rename desk 2.
    await page.locator('#s-deskcount').fill('3');
    await page.getByRole('button', { name: 'Auto-generate names' }).click();
    await page.getByLabel('Desk name 2').fill('Window Seat');

    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Step 7 — appears in the table.
    const row = page.locator('tr', { hasText: NAME.coworking });
    await expect(row).toBeVisible();

    coworkingSpaceId = await spaceIdByName(inc, NAME.coworking);

    // Step 8 — open Manage desks.
    await row.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Manage desks' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Step 9 — 3 desk rows in the grid.
    await expect(dialog.getByText('Desk 01', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Window Seat', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Desk 03', { exact: true })).toBeVisible();

    // Step 10/11 — block today's cell (first column) for Desk 01, assert Booked.
    const desk01Row = dialog.getByRole('row', { name: /Desk 01/ });
    await expect(desk01Row.getByRole('button').first()).toHaveAttribute('aria-label', 'Available');
    await desk01Row.getByRole('button').first().click();
    await expect(desk01Row.getByRole('button').first()).toHaveAttribute('aria-label', 'Booked');
  });

  // ── SUITE 2 — Create private office with details ───────────────────────────
  test('S2 — incubator creates a private office', async ({ page }) => {
    await openSpaceForm(page);

    await page.locator('#s-name').fill(NAME.office);
    await pickRadix(page, 's-category', 'Private office');
    await pickRadix(page, 's-city', 'Alger');
    await page.locator('#s-desc').fill('Automated e2e private office fixture. Safe to delete.');
    await page.locator('#s-officesize').fill('25');
    await page.locator('#s-officefloor').fill('2nd floor');
    await page.getByRole('button', { name: 'Air conditioning' }).click();
    await page.getByRole('button', { name: 'Natural light' }).click();
    // Bookable category → at least one price + capacity required. (Photo upload
    // goes through Cloudinary and is intentionally omitted from this e2e.)
    await page.locator('#s-day').fill('500');
    await page.locator('#s-cap').fill('1');

    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const row = page.locator('tr', { hasText: NAME.office });
    await expect(row).toBeVisible();
    // exact: the space NAME also contains "Private Office" — target the badge only.
    await expect(row.getByText('Private office', { exact: true })).toBeVisible();
  });

  // ── SUITE 3 — Create domiciliation space ───────────────────────────────────
  test('S3 — incubator creates a domiciliation space with 5 slots', async ({ page }) => {
    await openSpaceForm(page);

    await page.locator('#s-name').fill(NAME.domiciliation);
    await pickRadix(page, 's-category', 'Domiciliation');
    await pickRadix(page, 's-city', 'Alger');
    await page.locator('#s-desc').fill('Automated e2e domiciliation fixture. Safe to delete.');
    await page.locator('#s-slots').fill('5');

    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const row = page.locator('tr', { hasText: NAME.domiciliation });
    await expect(row).toBeVisible();
    // exact: the space NAME also contains "Domiciliation" — target the badge only.
    await expect(row.getByText('Domiciliation', { exact: true })).toBeVisible();

    domiciliationSpaceId = await spaceIdByName(inc, NAME.domiciliation);
    // The table doesn't surface the slot count — assert it on the created record.
    const space = readRaw().spaces.find((s) => s.id === domiciliationSpaceId);
    expect(space?.domiciliationSlots).toBe(5);
  });

  // ── SUITE 4 — Public: coworking desk picker hides the blocked desk ─────────
  test('S4 — public detail page shows only available desks', async ({ browser }) => {
    expect(coworkingSpaceId, 'Suite 1 must have created the coworking space').toBeTruthy();
    const { ctx, page } = await guestPage(browser);
    try {
      await page.goto(`/en/spaces/${coworkingSpaceId}`);
      await page.waitForLoadState('networkidle');
      // Desk 01 was blocked for today in Suite 1 → absent; the other two show.
      await expect(page.getByText('Window Seat', { exact: true })).toBeVisible();
      await expect(page.getByText('Desk 03', { exact: true })).toBeVisible();
      await expect(page.getByText('Desk 01', { exact: true })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  // ── SUITE 5 — Manual booking blocks the desk calendar + public page ────────
  test('S5 — manual booking blocks a desk everywhere', async ({ page, browser }) => {
    // Space + client via API (fixture setup); the BOOKING itself is via the UI.
    const space = await createSpace(inc, {
      name: NAME.block,
      category: 'COWORKING',
      deskNames: ['Desk A', 'Desk B'],
      pricePerHour: 500,
      pricePerDay: 3000,
    });
    const blockSpaceId = space.id;
    await createClient(inc, `QA Block Client ${TS}`, `block-${TS}@metwork-test.dz`);

    // Manual booking via the incubator dialog → select desk "Desk A", today.
    await page.goto('/en/dashboard/incubator/bookings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Manual booking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await pickRadix(page, 'mb-space', NAME.block);
    await pickRadix(page, 'mb-desk', 'Desk A');
    await page.locator('#mb-sd').fill(todayStr());
    await page.locator('#mb-ed').fill(todayStr());
    // Pick the pre-created client.
    await page.locator('#mb-client').click();
    await page.getByRole('option', { name: `QA Block Client ${TS}` }).click();
    await page.getByRole('button', { name: 'Create booking' }).click();
    await expect(page.getByText('Booking recorded successfully')).toBeVisible();

    // Desk calendar: Desk A booked today, Desk B available today.
    await page.goto('/en/dashboard/incubator/spaces');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr', { hasText: NAME.block });
    await row.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Manage desks' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const deskARow = dialog.getByRole('row', { name: /Desk A/ });
    const deskBRow = dialog.getByRole('row', { name: /Desk B/ });
    await expect(deskARow.getByRole('button').first()).toHaveAttribute('aria-label', 'Booked');
    await expect(deskBRow.getByRole('button').first()).toHaveAttribute('aria-label', 'Available');

    // Public page (guest): Desk B available, Desk A gone.
    const { ctx, page: gp } = await guestPage(browser);
    try {
      await gp.goto(`/en/spaces/${blockSpaceId}`);
      await gp.waitForLoadState('networkidle');
      await expect(gp.getByText('Desk B', { exact: true })).toBeVisible();
      await expect(gp.getByText('Desk A', { exact: true })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  // ── SUITE 6 — Manual booking desk conflict → friendly 409 + no booking ─────
  test('S6 — duplicate desk booking is rejected with a clear message', async ({ page }) => {
    // ≥2 desks so per-desk capacity isn't the gate — we want the DESK-level
    // conflict (one taken desk), not CAPACITY_EXCEEDED, to be what fires.
    const space = await createSpace(inc, {
      name: NAME.conflict,
      category: 'COWORKING',
      deskNames: ['Desk 1', 'Desk 2'],
      pricePerHour: 500,
      pricePerDay: 3000,
    });
    const conflictSpaceId = space.id;
    const tomorrow = dayUtc(1);

    // Seed a desk hold for "Desk 1" tomorrow (API).
    const seed = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: conflictSpaceId,
      unit: 'DAY',
      startsAt: `${tomorrow}T00:00:00.000Z`,
      endsAt: `${dayUtc(2)}T00:00:00.000Z`,
      deskName: 'Desk 1',
      clientName: `QA Seed ${TS}`,
    });
    expect(seed.status(), `seed manual booking → ${seed.status()} ${await seed.text()}`).toBe(201);

    const bookingsBefore = readRaw().bookings.filter((b) => b.itemId === conflictSpaceId).length;
    await createClient(inc, `QA Conflict Client ${TS}`, `conflict-${TS}@metwork-test.dz`);

    // Attempt a SECOND booking for the same desk + day via the UI.
    await page.goto('/en/dashboard/incubator/bookings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Manual booking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await pickRadix(page, 'mb-space', NAME.conflict);
    await pickRadix(page, 'mb-desk', 'Desk 1');
    await page.locator('#mb-sd').fill(tomorrow);
    await page.locator('#mb-ed').fill(tomorrow);
    await page.locator('#mb-client').click();
    await page.getByRole('option', { name: `QA Conflict Client ${TS}` }).click();
    await page.getByRole('button', { name: 'Create booking' }).click();

    // Friendly conflict message naming the day.
    await expect(page.getByText(/already booked for/i)).toBeVisible();
    await expect(page.getByText(tomorrow)).toBeVisible();

    // No new BookingRecord was created (atomic reject).
    const bookingsAfter = readRaw().bookings.filter((b) => b.itemId === conflictSpaceId).length;
    expect(bookingsAfter).toBe(bookingsBefore);
  });

  // ── SUITE 7 — Expiry-notifier cron route ───────────────────────────────────
  test('S7 — cron route sends expiry reminders once, and is auth-gated', async () => {
    const space = await createSpace(inc, {
      name: NAME.expiry,
      category: 'COWORKING',
      deskNames: ['Desk 1'],
      pricePerHour: 500,
      pricePerDay: 3000,
    });
    // A desk booking ending today + 2 → in the reminder window.
    const seed = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'DAY',
      startsAt: `${dayUtc(2)}T00:00:00.000Z`,
      endsAt: `${dayUtc(3)}T00:00:00.000Z`,
      deskName: 'Desk 1',
      clientName: `QA Expiry ${TS}`,
    });
    expect(seed.status(), `expiry seed → ${seed.status()} ${await seed.text()}`).toBe(201);

    const secret = cronSecret();
    expect(secret, 'CRON_SECRET must be set (server + .env.local)').toBeTruthy();
    const auth = { Authorization: `Bearer ${secret}` };

    const r1 = await inc.get('/api/cron/space-expiry', { headers: auth });
    expect(r1.status(), `cron 1 → ${r1.status()} ${await r1.text()}`).toBe(200);
    const b1 = (await r1.json()) as { sent: number; checked: number };
    expect(b1.sent).toBeGreaterThanOrEqual(1);
    expect(b1.checked).toBeGreaterThanOrEqual(1);

    // Immediate re-run → nothing new (expiryReminderSentAt guard).
    const r2 = await inc.get('/api/cron/space-expiry', { headers: auth });
    expect(r2.status()).toBe(200);
    expect(((await r2.json()) as { sent: number }).sent).toBe(0);

    // No Authorization → 401.
    const r3 = await inc.get('/api/cron/space-expiry');
    expect(r3.status()).toBe(401);
  });

  // ── SUITE 8 — Public: guest submits a domiciliation request ────────────────
  test('S8 — guest submits a domiciliation request → incubator sees it PENDING', async ({ page, browser }) => {
    expect(domiciliationSpaceId, 'Suite 3 must have created the domiciliation space').toBeTruthy();
    const guestEmail = `test-${TS}@metwork-test.dz`;

    const { ctx, page: gp } = await guestPage(browser);
    try {
      await gp.goto(`/en/spaces/${domiciliationSpaceId}`);
      await gp.waitForLoadState('networkidle');
      await expect(gp.getByText('5 addresses available')).toBeVisible();

      await gp.locator('#dom-name').fill(`Test User ${TS}`);
      await gp.locator('#dom-company').fill('Test Co');
      await gp.locator('#dom-phone').fill('+213555123456');
      await gp.locator('#dom-email').fill(guestEmail);
      await gp.getByRole('button', { name: 'Send request' }).click();
      await expect(gp.getByText('Request received')).toBeVisible();
    } finally {
      await ctx.close();
    }

    // Incubator dashboard shows the new request as PENDING.
    await page.goto('/en/dashboard/incubator/domiciliation');
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr', { hasText: guestEmail });
    await expect(row).toBeVisible();
    // "Pending" shows in both the status badge and the inline status select.
    await expect(row.getByText('Pending').first()).toBeVisible();
  });
});
