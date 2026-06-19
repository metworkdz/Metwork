/**
 * API-driven e2e: AVAILABILITY gating — the shared checkSpaceAvailability rules
 * enforced identically on the public wallet/cash flow AND the incubator's own
 * manual bookings.
 *
 * Four scenarios from the spec:
 *   1. A blocked date rejects a public booking AND a manual booking.
 *   2. Unblocking the date lets the manual booking through.
 *   3. A day holding an HOURLY booking rejects a full-day booking but still
 *      accepts another (non-overlapping) hourly booking.
 *   4. A day holding a FULL-DAY booking rejects everything else that day.
 *
 * Determinism: every test creates its OWN capacity-1 space (capacity 1 → any
 * overlap is OVERLAP_CONFLICT, never a partial-capacity CAPACITY_EXCEEDED) with
 * all-week working days (so a public booking never trips NOT_A_WORKING_DAY).
 * Occupancy is established with MANUAL bookings, which are auto-CONFIRMED and
 * therefore hold a seat — a public CASH booking is PENDING_PAYMENT and would
 * NOT occupy the slot.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  createSpace,
  setSpaceBlackouts,
  manualBooking,
  bookSpace,
  futureWeekdayUtc,
  utcWindow,
} from './_helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

async function expectErr(res: APIResponse, status: number, code: string): Promise<void> {
  const body = await res.json().catch(() => ({}));
  expect(res.status(), `expected ${status} ${code} → ${res.status()} ${JSON.stringify(body)}`).toBe(status);
  expect(body.error?.code, `expected code ${code} → ${JSON.stringify(body)}`).toBe(code);
}

test.describe('Availability gating', () => {
  let inc: APIRequestContext;
  let user: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    user = await roleContext('explorer'); // CASH bookings → no wallet funds needed
  });
  test.afterAll(async () => {
    await inc.dispose();
    await user.dispose();
  });

  // 1 + 2. Blocked date rejects public + manual; unblocking lets manual through.
  test('a blocked date rejects both public and manual bookings, and unblocking re-allows manual', async () => {
    const space = await createSpace(inc, { capacity: 1, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(8);
    const date = day.toISOString().slice(0, 10);
    const { startsAt, endsAt } = utcWindow(day, 10, 11);

    await setSpaceBlackouts(inc, space.id, { unavailableDates: [date] });

    // Public booking (CASH → no funds needed; the blackout gate runs first).
    await expectErr(
      await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'CASH'),
      422,
      'DATE_UNAVAILABLE',
    );

    // Manual booking — no blackout bypass for the incubator either.
    await expectErr(
      await manualBooking(inc, { itemKind: 'SPACE', itemId: space.id, unit: 'HOUR', startsAt, endsAt }),
      409,
      'DATE_UNAVAILABLE',
    );

    // Unblock → the manual booking now succeeds.
    await setSpaceBlackouts(inc, space.id, { unavailableDates: [] });
    const ok = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'HOUR',
      startsAt,
      endsAt,
    });
    expect(ok.status(), `manual after unblock → ${ok.status()} ${await ok.text()}`).toBe(201);
    expect((await ok.json()).booking.status).toBe('CONFIRMED');
  });

  // 3. Hourly booking on a day blocks a full-day booking but allows more hourly.
  test('a day with an hourly booking rejects a full-day booking but accepts another hourly slot', async () => {
    const space = await createSpace(inc, { capacity: 1, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(9);

    // Occupy 10:00–11:00 with a confirmed manual booking.
    const morning = utcWindow(day, 10, 11);
    const occupy = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'HOUR',
      startsAt: morning.startsAt,
      endsAt: morning.endsAt,
    });
    expect(occupy.status()).toBe(201);

    // A DAY booking covers the whole day → conflicts with the 10:00 slot.
    const fullDay = utcWindow(day, 9, 18);
    await expectErr(
      await bookSpace(user, space.id, 'DAY', fullDay.startsAt, fullDay.endsAt, 'CASH'),
      409,
      'OVERLAP_CONFLICT',
    );

    // A non-overlapping hourly slot (14:00–15:00) is still bookable.
    const afternoon = utcWindow(day, 14, 15);
    const more = await bookSpace(user, space.id, 'HOUR', afternoon.startsAt, afternoon.endsAt, 'CASH');
    expect(more.status(), `non-overlapping hourly → ${more.status()} ${await more.text()}`).toBe(201);
  });

  // 4. A full-day booking blocks every other booking that day (hourly + full-day).
  test('a day with a full-day booking rejects all further bookings that day', async () => {
    const space = await createSpace(inc, { capacity: 1, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(10);

    // Occupy the whole day with a confirmed manual DAY booking.
    const fullDay = utcWindow(day, 9, 18);
    const occupy = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'DAY',
      startsAt: fullDay.startsAt,
      endsAt: fullDay.endsAt,
    });
    expect(occupy.status()).toBe(201);

    // An hourly slot inside that day → conflict.
    const hour = utcWindow(day, 11, 12);
    await expectErr(
      await bookSpace(user, space.id, 'HOUR', hour.startsAt, hour.endsAt, 'CASH'),
      409,
      'OVERLAP_CONFLICT',
    );

    // Another full-day booking → conflict.
    await expectErr(
      await manualBooking(inc, {
        itemKind: 'SPACE',
        itemId: space.id,
        unit: 'DAY',
        startsAt: fullDay.startsAt,
        endsAt: fullDay.endsAt,
      }),
      409,
      'OVERLAP_CONFLICT',
    );
  });
});
