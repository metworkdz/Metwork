/**
 * API-driven e2e: space booking gates + space price guard.
 *
 * These tests exercise POST /api/bookings and the incubator space create /
 * patch price guards DIRECTLY through the JSON API (no UI). Every booking
 * window is built in UTC via the shared helpers, because the working-hours /
 * working-day gate computes day-of-week and HH:MM in UTC
 * (isoToUtcDow / isoToUtcMinutes in src/server/bookings/service.ts).
 *
 * Each test creates its OWN fresh space so overlap state never bleeds across
 * tests.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  createSpace,
  bookSpace,
  futureWeekdayUtc,
  futureSundayUtc,
  utcWindow,
  clientRef,
} from './_helpers';

/**
 * The JSON error envelope is `{ error: { code, message, details? } }`
 * (see src/server/http/json.ts). Some details (available, openingTime, …)
 * live under `error.details`. Resolve the error code robustly so a future
 * flattening of the envelope doesn't silently break these assertions.
 */
async function errCode(res: APIResponse): Promise<string | undefined> {
  const body = await res.json().catch(() => ({}));
  return body?.error?.code ?? body?.code;
}

/** Pretty-print a response (status + body) for assertion failure messages. */
async function dump(res: APIResponse): Promise<string> {
  return `${res.status()} ${await res.text()}`;
}

test.describe('Space booking + price guard', () => {
  let inc: APIRequestContext;
  let builder: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    builder = await roleContext('builder');
  });

  test.afterAll(async () => {
    await inc.dispose();
    await builder.dispose();
  });

  test('valid HOUR booking inside working hours succeeds (201)', async () => {
    const space = await createSpace(inc);
    const base = futureWeekdayUtc();
    const { startsAt, endsAt } = utcWindow(base, 10, 12);

    const res = await bookSpace(builder, space.id, 'HOUR', startsAt, endsAt);
    expect(res.status(), `expected 201, got ${await dump(res)}`).toBe(201);

    const body = await res.json();
    expect(body.booking, `booking missing in success body → ${JSON.stringify(body)}`).toBeTruthy();
    expect(body.booking.id, `booking.id missing → ${JSON.stringify(body)}`).toBeTruthy();
  });

  test('OUTSIDE_WORKING_HOURS when start is before opening (07:00 < 09:00)', async () => {
    const space = await createSpace(inc);
    const base = futureWeekdayUtc();
    const { startsAt, endsAt } = utcWindow(base, 7, 8);

    const res = await bookSpace(builder, space.id, 'HOUR', startsAt, endsAt);
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res), `expected OUTSIDE_WORKING_HOURS, got ${await dump(res)}`).toBe(
      'OUTSIDE_WORKING_HOURS',
    );

    const body = await res.json();
    expect(body.error?.details?.openingTime, `openingTime → ${JSON.stringify(body)}`).toBe('09:00');
    expect(body.error?.details?.closingTime, `closingTime → ${JSON.stringify(body)}`).toBe('18:00');
  });

  test('OUTSIDE_WORKING_HOURS when end is after closing (19:00 > 18:00)', async () => {
    const space = await createSpace(inc);
    const base = futureWeekdayUtc();
    const { startsAt, endsAt } = utcWindow(base, 17, 19);

    const res = await bookSpace(builder, space.id, 'HOUR', startsAt, endsAt);
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res), `expected OUTSIDE_WORKING_HOURS, got ${await dump(res)}`).toBe(
      'OUTSIDE_WORKING_HOURS',
    );

    const body = await res.json();
    expect(body.error?.details?.openingTime, `openingTime → ${JSON.stringify(body)}`).toBe('09:00');
    expect(body.error?.details?.closingTime, `closingTime → ${JSON.stringify(body)}`).toBe('18:00');
  });

  test('NOT_A_WORKING_DAY when booking lands on a Sunday', async () => {
    const space = await createSpace(inc); // default workingDays Mon–Fri
    const base = futureSundayUtc();
    const { startsAt, endsAt } = utcWindow(base, 10, 12);

    const res = await bookSpace(builder, space.id, 'HOUR', startsAt, endsAt);
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res), `expected NOT_A_WORKING_DAY, got ${await dump(res)}`).toBe(
      'NOT_A_WORKING_DAY',
    );

    const body = await res.json();
    expect(body.error?.details?.workingDays, `workingDays → ${JSON.stringify(body)}`).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test('OVERLAP_CONFLICT when a second booking overlaps the first', async () => {
    // Book a FREE space (price 0) ONLINE → status PENDING, which HOLDS a seat in
    // the availability gate. A CASH booking is PENDING_PAYMENT and holds NO seat
    // (see seatHolding in availability.ts), so two CASH bookings would never
    // conflict — the overlap gate is exercised only by seat-holding bookings.
    // capacity 1 → any overlap is OVERLAP_CONFLICT (capacity > 1 would be the
    // partial-capacity CAPACITY_EXCEEDED path instead).
    const space = await createSpace(inc, { pricePerHour: 0, capacity: 1 });
    const base = futureWeekdayUtc();

    const first = await bookSpace(builder, space.id, 'HOUR', ...windowTuple(base, 10, 12), 'ONLINE');
    expect(first.status(), `first booking expected 201, got ${await dump(first)}`).toBe(201);

    const second = await bookSpace(builder, space.id, 'HOUR', ...windowTuple(base, 11, 13), 'ONLINE');
    expect(second.status(), `second booking expected 409, got ${await dump(second)}`).toBe(409);
    expect(await errCode(second), `expected OVERLAP_CONFLICT, got ${await dump(second)}`).toBe(
      'OVERLAP_CONFLICT',
    );

    const body = await second.json();
    expect(
      body.error?.details?.conflictingBookingId,
      `conflictingBookingId → ${JSON.stringify(body)}`,
    ).toBeTruthy();
  });

  test('two non-overlapping bookings on the same space both succeed', async () => {
    const space = await createSpace(inc);
    const base = futureWeekdayUtc();

    const a = await bookSpace(builder, space.id, 'HOUR', ...windowTuple(base, 10, 11));
    expect(a.status(), `first booking expected 201, got ${await dump(a)}`).toBe(201);

    const b = await bookSpace(builder, space.id, 'HOUR', ...windowTuple(base, 14, 15));
    expect(b.status(), `second booking expected 201, got ${await dump(b)}`).toBe(201);
  });

  test('UNIT_NOT_AVAILABLE when booking an HOUR on a DAY-only space', async () => {
    const space = await createSpace(inc, { pricePerHour: null, pricePerDay: 3000 });
    const base = futureWeekdayUtc();
    const { startsAt, endsAt } = utcWindow(base, 10, 12);

    const res = await bookSpace(builder, space.id, 'HOUR', startsAt, endsAt);
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res), `expected UNIT_NOT_AVAILABLE, got ${await dump(res)}`).toBe(
      'UNIT_NOT_AVAILABLE',
    );

    const body = await res.json();
    const available = body.error?.details?.available;
    expect(available, `available → ${JSON.stringify(body)}`).toContain('DAY');
    expect(available, `available should not include HOUR → ${JSON.stringify(body)}`).not.toContain(
      'HOUR',
    );
  });

  test('create price guard rejects a space with all three prices null (422)', async () => {
    // Build the payload inline — do NOT use createSpace (it asserts 201).
    const res = await inc.post('/api/incubator/spaces', {
      data: {
        name: `QA NoPrice ${clientRef('sp')}`,
        description: 'Space with no pricing units — must be rejected by the guard.',
        category: 'COWORKING',
        city: 'Alger',
        capacity: 10,
        amenities: [],
        acceptedPaymentMethods: ['ONLINE'],
        workingDays: [1, 2, 3, 4, 5],
        openingTime: '09:00',
        closingTime: '18:00',
        pricePerHour: null,
        pricePerDay: null,
        pricePerMonth: null,
      },
    });
    // The guard is a zod `.refine`, so the failure is surfaced via fromZod()
    // → 422 VALIDATION_ERROR (NOT 400). See src/server/http/json.ts:fromZod.
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res), `expected VALIDATION_ERROR, got ${await dump(res)}`).toBe(
      'VALIDATION_ERROR',
    );
  });

  test('PATCH NO_PRICE guard rejects nulling all prices and leaves the space intact', async () => {
    const space = await createSpace(inc); // pricePerHour 500, pricePerDay 3000
    const res = await inc.patch(`/api/incubator/spaces/${space.id}`, {
      data: { pricePerHour: null, pricePerDay: null, pricePerMonth: null },
    });
    expect(res.status(), `expected 400, got ${await dump(res)}`).toBe(400);
    expect(await errCode(res), `expected NO_PRICE, got ${await dump(res)}`).toBe('NO_PRICE');

    // Reject-before-mutate: the space must still carry its original prices.
    const list = await inc.get('/api/incubator/spaces');
    expect(list.status(), `space list expected 200, got ${await dump(list)}`).toBe(200);
    const { items } = await list.json();
    const found = (items as Array<{ id: string; pricePerHour: number | null; pricePerDay: number | null }>).find(
      (s) => s.id === space.id,
    );
    expect(found, `space ${space.id} not found in list`).toBeTruthy();
    expect(found?.pricePerHour, `pricePerHour must be untouched → ${JSON.stringify(found)}`).toBe(500);
    expect(found?.pricePerDay, `pricePerDay must be untouched → ${JSON.stringify(found)}`).toBe(3000);
  });
});

/**
 * Spread-friendly window builder: returns the positional [unit-aligned] tuple
 * `[startsAt, endsAt]` so it can be spread straight into bookSpace's
 * (startsAt, endsAt) positional params.
 */
function windowTuple(base: Date, startHour: number, endHour: number): [string, string] {
  const { startsAt, endsAt } = utcWindow(base, startHour, endHour);
  return [startsAt, endsAt];
}
