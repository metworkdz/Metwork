/**
 * 🔵 LIVE VERIFICATION — manual booking must reserve the availability calendar.
 *
 * Reproduces the reported bug end-to-end against the REAL store (dev server
 * without USE_LOCAL_DB), as the real incubator account:
 *
 *   1. Log in (creds via E2E_EMAIL / E2E_PASSWORD env vars — never committed).
 *   2. Create a DAILY manual booking on the "Training room" space via the
 *      dialog UI (space-first, single availability calendar).
 *   3. GUEST view: the public space page's calendar must show that date as
 *      reserved (cell disabled), and the canonical availability API must
 *      report a BOOKING interval covering it.
 *   4. CLEANUP: delete the demo booking (and the demo CRM client), then assert
 *      the date is free again. The spec leaves the store exactly as it found it.
 *
 * ONE test = ONE login (the login route caps each email at 10 logins/hour).
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

const CLIENT_NAME = 'E2E Verify Client';
const CLIENT_EMAIL = 'e2e-verify@metwork-test.dz';

interface AvailabilityView {
  workingDays: number[];
  intervals: { start: string; end: string; kind: 'BOOKING' | 'BLOCK'; allDay: boolean }[];
}

/** YYYY-MM-DD for today + n days (UTC — matches the server's day arithmetic). */
function dayUtc(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True when any interval overlaps the UTC day `date`. */
function dayHasInterval(view: AvailabilityView, date: string, kind?: 'BOOKING' | 'BLOCK'): boolean {
  const dayStart = Date.parse(`${date}T00:00:00.000Z`);
  const dayEnd = dayStart + 86_400_000;
  return view.intervals.some((iv) => {
    if (kind && iv.kind !== kind) return false;
    const s = Date.parse(iv.start);
    const e = Date.parse(iv.end);
    return s < dayEnd && e > dayStart;
  });
}

/** Months to advance from the current month to reach `date`'s month. */
function monthsAhead(date: string): number {
  const now = new Date();
  const [y, m] = date.split('-').map(Number);
  return (y! - now.getUTCFullYear()) * 12 + (m! - (now.getUTCMonth() + 1));
}

/** Click the calendar's "Next month" arrow `n` times (scoped to `root`). */
async function advanceMonths(root: Page | ReturnType<Page['locator']>, n: number) {
  for (let i = 0; i < n; i++) {
    await (root as Page).getByRole('button', { name: 'Next month' }).first().click();
  }
}

test('manual booking on the training room reserves the public calendar (then cleanup)', async ({ page, browser }) => {
  expect(EMAIL, 'E2E_EMAIL env var is required').toBeTruthy();
  expect(PASSWORD, 'E2E_PASSWORD env var is required').toBeTruthy();

  /* ── 1. Login ─────────────────────────────────────────────────────────── */
  await page.goto('/en/login');
  await page.waitForLoadState('networkidle');
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/dashboard/, { timeout: 30_000 });

  /* ── Resolve the training-room space + a conflict-free target date ────── */
  const spacesRes = await page.request.get('/api/incubator/spaces');
  expect(spacesRes.ok(), `list spaces → ${spacesRes.status()}`).toBeTruthy();
  const { items } = (await spacesRes.json()) as { items: Array<{ id: string; name: string; category: string }> };
  const room = items.find((s) => /training/i.test(s.name));
  expect(room, 'a "Training room" space must exist on this account').toBeTruthy();

  // First working day in [today+30, today+75] with no existing interval — far
  // enough out to dodge the real bookings already on the calendar.
  const availRes = await page.request.get(
    `/api/spaces/${room!.id}/availability?from=${dayUtc(30)}&to=${dayUtc(75)}`,
  );
  expect(availRes.ok(), `availability → ${availRes.status()}`).toBeTruthy();
  const before = (await availRes.json()) as AvailabilityView;
  let target = '';
  for (let n = 30; n <= 75; n++) {
    const d = dayUtc(n);
    const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
    if (!before.workingDays.includes(dow)) continue;
    if (dayHasInterval(before, d)) continue;
    target = d;
    break;
  }
  expect(target, 'a free working day must exist within 75 days').toBeTruthy();

  /* ── Demo CRM client (idempotent by email; removed in cleanup) ────────── */
  const clientRes = await page.request.post('/api/incubator/clients', {
    data: { fullName: CLIENT_NAME, email: CLIENT_EMAIL, phone: '+213555000111' },
  });
  expect([200, 201], `create client → ${clientRes.status()}`).toContain(clientRes.status());
  const demoClient = (await clientRes.json()) as { id: string };

  /* ── 2. Create the manual booking via the dialog UI ───────────────────── */
  await page.goto('/en/dashboard/incubator/bookings');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Manual booking' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // SPACE-FIRST: the form is gated until a space is explicitly chosen.
  await expect(dialog.getByText('Select a space to continue.')).toBeVisible();
  await page.locator('#mb-space').click();
  await page.getByRole('option', { name: room!.name }).click();

  // Daily unit → the booking takes the whole day.
  await page.locator('#mb-unit').click();
  await page.getByRole('option', { name: 'Daily' }).click();

  // ONE availability calendar — advance to the target month, pick the day.
  await advanceMonths(page, monthsAhead(target));
  const targetCell = page.locator(`[data-date="${target}"]`);
  await expect(targetCell).toBeEnabled();
  await targetCell.click();
  await expect(dialog.getByText(target).first()).toBeVisible();

  // Client via the searchable picker. The search input is the one wired to the
  // picker's listbox (Radix Select triggers also carry role=combobox).
  await page.locator('#mb-client').click();
  await page.locator('input[aria-controls="client-picker-list"]').fill(CLIENT_NAME);
  await page.getByRole('option', { name: new RegExp(CLIENT_NAME) }).click();

  await page.getByRole('button', { name: 'Create booking' }).click();
  await expect(page.getByText('Booking recorded successfully')).toBeVisible();

  // Resolve the created booking id (for cleanup).
  const listRes = await page.request.get('/api/incubator/bookings');
  const list = (await listRes.json()) as { items: Array<{ id: string; customerName: string; startsAt: string }> };
  const created = list.items.find(
    (b) => b.customerName === CLIENT_NAME && b.startsAt.startsWith(target),
  );
  expect(created, 'the manual booking must appear in the bookings list').toBeTruthy();

  /* ── 3. Public (guest) verification — the date must be RESERVED ───────── */
  // Canonical API first: a BOOKING interval must now cover the target day.
  const afterRes = await page.request.get(
    `/api/spaces/${room!.id}/availability?from=${target}&to=${target}`,
  );
  const after = (await afterRes.json()) as AvailabilityView;
  expect(
    dayHasInterval(after, target, 'BOOKING'),
    `availability API must report a BOOKING interval on ${target}`,
  ).toBe(true);

  // Then the public page a client actually sees (fresh guest context).
  const guestCtx = await browser.newContext({
    baseURL: 'http://localhost:3000',
    storageState: { cookies: [], origins: [] },
  });
  try {
    const guest = await guestCtx.newPage();
    await guest.goto(`/en/spaces/${room!.id}`);
    await guest.waitForLoadState('networkidle');
    await advanceMonths(guest, monthsAhead(target));
    const publicCell = guest.locator(`[data-date="${target}"]`);
    await expect(publicCell, 'the booked date must not be selectable on the public calendar').toBeDisabled();
  } finally {
    await guestCtx.close();
  }

  /* ── 4. CLEANUP — delete the demo booking + client, verify date freed ─── */
  const del = await page.request.delete(`/api/incubator/bookings/${created!.id}`);
  expect(del.ok(), `delete booking → ${del.status()} ${await del.text()}`).toBeTruthy();
  const delClient = await page.request.delete(`/api/incubator/clients/${demoClient.id}`);
  expect([200, 204]).toContain(delClient.status());

  const freedRes = await page.request.get(
    `/api/spaces/${room!.id}/availability?from=${target}&to=${target}`,
  );
  const freed = (await freedRes.json()) as AvailabilityView;
  expect(
    dayHasInterval(freed, target, 'BOOKING'),
    `after cleanup, no BOOKING interval may remain on ${target}`,
  ).toBe(false);
});
