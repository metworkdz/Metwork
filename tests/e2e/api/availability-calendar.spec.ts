/**
 * API-driven e2e: the AIRBNB AVAILABILITY CALENDAR end-to-end, asserted against
 * the SINGLE canonical source `GET /api/spaces/:id/availability?from&to`.
 *
 * This proves the public calendar, the owner block editor, and the booking write
 * gate all agree because they read/write the same fields:
 *   1. Manual (offline) booking on X      → X shows a BOOKING interval publicly.
 *   2. Online booking on Y                → Y shows BOOKING; a 2nd booking on Y is
 *                                            rejected by the overlap check.
 *   3. Block NON-CONTIGUOUS dates (the TAP-multi payload: one POST { dates:[…] })
 *                                          → each shows BLOCK and is unbookable.
 *   4. Block a CONTIGUOUS range (the DRAG payload: one POST with the range)
 *                                          → the whole range shows BLOCK.
 *   5. Unblock a date                     → it disappears from the response and is
 *                                            bookable again.
 *   6. Cancel a booking                   → its BOOKING interval is released.
 *   7. Block/unblock are IDEMPOTENT       → replays don't error or duplicate.
 *
 * Each test owns a capacity-1, all-week, FREE space: capacity 1 → any overlap is a
 * clean OVERLAP_CONFLICT; all-week → a public booking never trips NOT_A_WORKING_DAY;
 * free price → an ONLINE booking settles to PENDING (which HOLDS a seat) without
 * needing wallet funds.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  createSpace,
  manualBooking,
  bookSpace,
  futureWeekdayUtc,
  utcWindow,
  getAvailability,
  hasInterval,
  blockSpaceDates,
  unblockSpaceDates,
  cancelBooking,
  consecutiveUtcDates,
} from './_helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
const RANGE_FROM = consecutiveUtcDates(0, 1)[0]!;
const RANGE_TO = consecutiveUtcDates(75, 1)[0]!;

const FREE_SPACE = { capacity: 1, workingDays: ALL_WEEK, pricePerHour: 0, pricePerDay: 0 } as const;

async function expectErr(res: APIResponse, status: number, code: string): Promise<void> {
  const body = await res.json().catch(() => ({}));
  expect(res.status(), `expected ${status} ${code} → ${res.status()} ${JSON.stringify(body)}`).toBe(status);
  expect(body.error?.code, `expected code ${code} → ${JSON.stringify(body)}`).toBe(code);
}

/** A whole-day [09:00,18:00) window on the given YYYY-MM-DD date. */
function dayWindow(date: string): { startsAt: string; endsAt: string } {
  return utcWindow(new Date(`${date}T00:00:00.000Z`), 9, 18);
}

test.describe('Availability calendar — single canonical source', () => {
  let inc: APIRequestContext;
  let user: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    user = await roleContext('explorer');
  });
  test.afterAll(async () => {
    await inc.dispose();
    await user.dispose();
  });

  // 1. Incubator manual booking on X → X is unavailable publicly + unbookable.
  test('a manual (offline) booking marks its day unavailable on the public calendar', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const day = futureWeekdayUtc(8);
    const date = day.toISOString().slice(0, 10);
    const { startsAt, endsAt } = utcWindow(day, 9, 18);

    const mb = await manualBooking(inc, { itemKind: 'SPACE', itemId: space.id, unit: 'DAY', startsAt, endsAt });
    expect(mb.status(), `manual booking → ${mb.status()} ${await mb.text()}`).toBe(201);

    const view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, date, 'BOOKING'), 'X should show a BOOKING interval').toBe(true);

    // A public booking on the same day now conflicts.
    await expectErr(await bookSpace(user, space.id, 'DAY', startsAt, endsAt, 'CASH'), 409, 'OVERLAP_CONFLICT');
  });

  // 2. Online booking on Y → Y unavailable; a second booking on Y is rejected.
  test('an online booking blocks the day and a second booking on it is rejected', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const day = futureWeekdayUtc(9);
    const date = day.toISOString().slice(0, 10);
    const { startsAt, endsAt } = utcWindow(day, 9, 18);

    const first = await bookSpace(user, space.id, 'DAY', startsAt, endsAt, 'ONLINE');
    expect(first.status(), `first booking → ${first.status()} ${await first.text()}`).toBe(201);
    expect((await first.json()).booking.status).toBe('PENDING'); // PENDING holds a seat

    const view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, date, 'BOOKING'), 'Y should show a BOOKING interval').toBe(true);

    await expectErr(await bookSpace(user, space.id, 'DAY', startsAt, endsAt, 'CASH'), 409, 'OVERLAP_CONFLICT');
  });

  // 3. Block NON-CONTIGUOUS dates in ONE request (the TAP-multi payload).
  test('blocking non-contiguous dates marks exactly those days, leaving gaps bookable', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const [d1, d2, d3] = consecutiveUtcDates(13, 3) as [string, string, string];

    const res = await blockSpaceDates(inc, space.id, [d1, d3]); // skip d2
    expect(res.status(), `block → ${res.status()} ${await res.text()}`).toBe(200);

    const view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, d1, 'BLOCK'), 'd1 blocked').toBe(true);
    expect(hasInterval(view, d3, 'BLOCK'), 'd3 blocked').toBe(true);
    expect(hasInterval(view, d2, 'BLOCK'), 'd2 (gap) NOT blocked').toBe(false);

    // A blocked day rejects a public booking; the gap day accepts one.
    const w1 = dayWindow(d1);
    await expectErr(await bookSpace(user, space.id, 'DAY', w1.startsAt, w1.endsAt, 'CASH'), 422, 'DATE_UNAVAILABLE');
    const w2 = dayWindow(d2);
    const gapOk = await bookSpace(user, space.id, 'DAY', w2.startsAt, w2.endsAt, 'CASH');
    expect(gapOk.status(), `gap day bookable → ${gapOk.status()} ${await gapOk.text()}`).toBe(201);
  });

  // 4. Block a CONTIGUOUS range in ONE request (the DRAG payload).
  test('blocking a contiguous range blocks every day in it', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const range = consecutiveUtcDates(20, 4); // 4 consecutive days

    const res = await blockSpaceDates(inc, space.id, range);
    expect(res.status(), `block range → ${res.status()} ${await res.text()}`).toBe(200);

    const view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    for (const date of range) {
      expect(hasInterval(view, date, 'BLOCK'), `${date} blocked`).toBe(true);
    }
  });

  // 5. Unblock a date → available again.
  test('unblocking a date releases it on the calendar', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const [d1] = consecutiveUtcDates(30, 1) as [string];

    await blockSpaceDates(inc, space.id, [d1]);
    let view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, d1, 'BLOCK'), 'blocked first').toBe(true);

    const un = await unblockSpaceDates(inc, space.id, [d1]);
    expect(un.status(), `unblock → ${un.status()} ${await un.text()}`).toBe(200);

    view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, d1, 'BLOCK'), 'released').toBe(false);

    const w = dayWindow(d1);
    const ok = await bookSpace(user, space.id, 'DAY', w.startsAt, w.endsAt, 'CASH');
    expect(ok.status(), `bookable after unblock → ${ok.status()} ${await ok.text()}`).toBe(201);
  });

  // 6. Cancelling a booking releases its date.
  test('cancelling a booking releases its date on the calendar', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const day = futureWeekdayUtc(11);
    const date = day.toISOString().slice(0, 10);
    const { startsAt, endsAt } = utcWindow(day, 9, 18);

    const first = await bookSpace(user, space.id, 'DAY', startsAt, endsAt, 'ONLINE');
    expect(first.status(), `booking → ${first.status()} ${await first.text()}`).toBe(201);
    const bookingId = (await first.json()).booking.id as string;

    let view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, date, 'BOOKING'), 'booked before cancel').toBe(true);

    const cancel = await cancelBooking(user, bookingId);
    expect(cancel.status(), `cancel → ${cancel.status()} ${await cancel.text()}`).toBe(200);

    view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(view, date, 'BOOKING'), 'released after cancel').toBe(false);
  });

  // 7. Block / unblock are idempotent (replays neither error nor duplicate).
  test('block and unblock are idempotent', async () => {
    const space = await createSpace(inc, { ...FREE_SPACE });
    const [d1] = consecutiveUtcDates(40, 1) as [string];

    const b1 = await blockSpaceDates(inc, space.id, [d1]);
    expect(b1.status()).toBe(200);
    const b2 = await blockSpaceDates(inc, space.id, [d1]); // replay
    expect(b2.status(), `block replay → ${b2.status()} ${await b2.text()}`).toBe(200);
    const body2 = await b2.json();
    expect(body2.unavailableDates.filter((x: string) => x === d1)).toHaveLength(1); // no duplicate

    const view = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    const blocks = view.intervals.filter((iv) => iv.kind === 'BLOCK' && iv.start.slice(0, 10) === d1);
    expect(blocks, 'exactly one BLOCK interval').toHaveLength(1);

    const u1 = await unblockSpaceDates(inc, space.id, [d1]);
    expect(u1.status()).toBe(200);
    const u2 = await unblockSpaceDates(inc, space.id, [d1]); // replay
    expect(u2.status(), `unblock replay → ${u2.status()} ${await u2.text()}`).toBe(200);

    const after = await getAvailability(user, space.id, RANGE_FROM, RANGE_TO);
    expect(hasInterval(after, d1, 'BLOCK'), 'fully released').toBe(false);
  });
});
