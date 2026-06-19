/**
 * API-driven e2e: INCUBATOR management — creating the bookable catalog.
 *
 * Covers the incubator's authoring surface: spaces across categories (with
 * custom working hours + duration discounts), full-day blackout set/clear,
 * programs, events, and a manual (offline) booking. Gating/availability rules
 * are asserted separately in availability.spec.ts; here we assert the records
 * are created with the right shape.
 *
 * All fixtures are owned by the seeded `qa-incubator` (COMMISSION plan). Runs
 * serially under playwright.api.config.ts (workers:1) against the shared doc.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createProgram,
  createEvent,
  createSpace,
  setSpaceBlackouts,
  manualBooking,
  futureWeekdayUtc,
  utcWindow,
} from './_helpers';

test.describe('Incubator — catalog authoring', () => {
  let inc: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
  });
  test.afterAll(async () => {
    await inc.dispose();
  });

  // 1. Spaces across the three bookable categories, each with bespoke working
  //    hours + duration discounts (coworking / meeting room / training room).
  test('creates spaces in coworking, private-office and training-room categories with working hours + duration discounts', async () => {
    const cases = [
      { category: 'COWORKING' as const, workingDays: [0, 1, 2, 3, 4, 5, 6], opening: '08:00', closing: '20:00' },
      { category: 'PRIVATE_OFFICE' as const, workingDays: [1, 2, 3, 4, 5], opening: '09:00', closing: '17:00' },
      { category: 'TRAINING_ROOM' as const, workingDays: [1, 2, 3, 4, 5, 6], opening: '10:00', closing: '18:00' },
    ];
    for (const c of cases) {
      const space = await createSpace(inc, {
        category: c.category,
        workingDays: c.workingDays,
        openingTime: c.opening,
        closingTime: c.closing,
        durationDiscounts: [
          { unit: 'DAY', minQty: 3, percent: 10 },
          { unit: 'HOUR', minQty: 5, percent: 15 },
        ],
      });
      expect(space.category, `category should round-trip → ${JSON.stringify(space)}`).toBe(c.category);
      expect(space.workingDays).toEqual(c.workingDays);
      expect(space.openingTime).toBe(c.opening);
      expect(space.closingTime).toBe(c.closing);
      expect(space.durationDiscounts).toEqual([
        { unit: 'DAY', minQty: 3, percent: 10 },
        { unit: 'HOUR', minQty: 5, percent: 15 },
      ]);
      expect(space.isActive).toBe(true);
    }
  });

  // 2. Full-day blackouts: set a blocked date (+ a time-range blackout), read it
  //    back, then clear it.
  test('sets and clears blackouts on a space', async () => {
    const space = await createSpace(inc, { workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const date = futureWeekdayUtc(6).toISOString().slice(0, 10);

    await setSpaceBlackouts(inc, space.id, {
      unavailableDates: [date],
      blackouts: [{ date, from: '12:00', to: '14:00' }],
    });

    const read = await inc.get(`/api/incubator/spaces/${space.id}/availability`);
    expect(read.status()).toBe(200);
    const cfg = await read.json();
    expect(cfg.unavailableDates).toContain(date);
    expect(cfg.blackouts).toEqual([{ date, from: '12:00', to: '14:00' }]);

    // Clear everything.
    await setSpaceBlackouts(inc, space.id, { unavailableDates: [], blackouts: [] });
    const cleared = await (await inc.get(`/api/incubator/spaces/${space.id}/availability`)).json();
    expect(cleared.unavailableDates).toEqual([]);
    expect(cleared.blackouts).toEqual([]);
  });

  // 3. Program + event creation (TRAINING program + workshop event).
  test('creates a program and an event', async () => {
    const program = await createProgram(inc, { type: 'TRAINING', seatsTotal: 25, price: 0 });
    expect(program.id).toBeTruthy();
    expect(program.seatsTotal).toBe(25);

    const event = await createEvent(inc, { capacity: 50, price: 0 });
    expect(event.id).toBeTruthy();
    expect(event.capacity).toBe(50);
  });

  // 4. Manual (offline) booking — auto-CONFIRMED, paymentMethod 'manual'.
  test('records a manual offline booking that is auto-confirmed', async () => {
    const space = await createSpace(inc, { capacity: 5, workingDays: [0, 1, 2, 3, 4, 5, 6] });
    const day = futureWeekdayUtc(7);
    const { startsAt, endsAt } = utcWindow(day, 10, 11);

    const res = await manualBooking(inc, {
      itemKind: 'SPACE',
      itemId: space.id,
      unit: 'HOUR',
      startsAt,
      endsAt,
      clientName: 'QA Walk-in Client',
    });
    expect(res.status(), `manual booking → ${res.status()} ${await res.text()}`).toBe(201);
    const { booking } = await res.json();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.source).toBe('offline');
    expect(booking.paymentMethod).toBe('manual');
    expect(booking.clientName).toBe('QA Walk-in Client');
  });
});
