/**
 * API-driven e2e — REGRESSION SMOKE.
 *
 * Proves the manual-withdrawal work did NOT disturb the untouched money +
 * booking + consultation paths:
 *   8. SlickPay CHECKOUT / collection — a wallet top-up settles through the
 *      provider and credits the balance (the client-payment path).
 *   9. Bookings still function — an ONLINE space booking charges the wallet by
 *      the exact server total; a consultation instant-book still confirms.
 *
 * (Hydration — assertion 10 — is covered by the UI project in
 *  withdrawal-ui.spec.ts, where a real browser can observe console errors.)
 *
 * Serial, workers:1, MOCK_PAYMENT_MODE=sync, USE_LOCAL_DB=true.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  bookSpace,
  walletBalance,
  topUp,
  futureWeekdayUtc,
  utcWindow,
  findBookingByRef,
  clientRef,
  SEED,
} from './_helpers';
import { nextUniqueSlot, instantBook } from './_consult-helpers';

test.describe.serial('Regression smoke — payments, bookings, consultation still work', () => {
  let founder: APIRequestContext;
  let builder: APIRequestContext;

  test.beforeAll(async () => {
    founder = await roleContext('founder');
    builder = await roleContext('builder');
  });

  test.afterAll(async () => {
    await founder.dispose();
    await builder.dispose();
  });

  // 8. SlickPay collection — top-up settles synchronously and credits the wallet.
  test('SlickPay checkout/collection: a wallet top-up settles and credits the balance', async () => {
    const before = await walletBalance(builder);
    const after = await topUp(builder, 6000);
    expect(after, 'top-up returns the post-credit balance').toBe(before + 6000);
    expect(await walletBalance(builder), 'credit persisted').toBe(before + 6000);
  });

  // 9a. Bookings — an ONLINE space booking charges the wallet by the exact
  //     total. Books the seeded HOUR-priced coworking space (Mon–Fri, 09–18)
  //     to stay independent of the evolving space-creation schema.
  test('bookings still work: an ONLINE space booking charges the wallet by the server total', async () => {
    const day = futureWeekdayUtc(18); // a weekday (matches the seed's Mon–Fri)
    const { startsAt, endsAt } = utcWindow(day, 9, 11); // 2h → 1000 DZD
    const ref = clientRef('smoke-book');

    const before = await walletBalance(builder);
    const res = await bookSpace(builder, SEED.spaceId, 'HOUR', startsAt, endsAt, 'ONLINE', ref);
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const body = await res.json();

    expect(before - (await walletBalance(builder)), 'wallet debited by the booking total')
      .toBe(body.booking.totalAmount);
    expect(findBookingByRef(ref), 'booking persisted in server state').toBeTruthy();
  });

  // 9b. Consultation — an instant-book still confirms against the seeded
  //     mentor's availability (no re-config needed; the consultation project
  //     covers the deeper lifecycle).
  test('consultation still works: an instant-book confirms', async () => {
    const slot = nextUniqueSlot();
    const res = await instantBook(founder, { ...slot, durationMinutes: 60 });
    expect(res.status(), `instant-book → ${res.status()} ${await res.text()}`).toBe(201);
    expect((await res.json()).mode, 'member instant-book confirms immediately').toBe('confirmed');
  });
});
