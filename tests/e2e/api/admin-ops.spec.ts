/**
 * API-driven e2e: ADMIN / provider operations.
 *
 *   1. Booking approval — the incubator confirms a PENDING wallet booking,
 *      crediting its payout wallet.
 *   2. Withdrawal approve — escrow held on request; approval leaves the wallet
 *      as-is (funds already transferred) and a re-decision is rejected.
 *   3. Withdrawal reject — the escrowed amount is refunded to the wallet.
 *   4. Promo code CRUD — create, read (list), update (discount), and deactivate
 *      (DELETE is intentionally unsupported; deactivation is the soft-delete).
 *
 * Money + lifecycle asserted from server state. Serial under the api config.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createSpace,
  bookSpace,
  topUp,
  walletBalance,
  readLocalDb,
  futureWeekdayUtc,
  utcWindow,
  SEED,
} from './_helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

function walletOf(userId: string): number {
  const w = readLocalDb().wallets.find((x) => x.userId === userId);
  return w ? w.balance : 0;
}

test.describe.serial('Admin / provider operations', () => {
  let admin: APIRequestContext;
  let inc: APIRequestContext;
  let founder: APIRequestContext;

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    inc = await roleContext('incubator');
    founder = await roleContext('founder');
    await topUp(founder, 60_000); // fund once (top-up is rate-limited)
  });
  test.afterAll(async () => {
    await admin.dispose();
    await inc.dispose();
    await founder.dispose();
  });

  // 1. Incubator approves a PENDING wallet booking → CONFIRMED + payout credit.
  test('approving a pending wallet booking confirms it and credits the incubator payout wallet', async () => {
    const space = await createSpace(inc, { pricePerHour: 800, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(19);
    const { startsAt, endsAt } = utcWindow(day, 9, 11);

    const res = await bookSpace(founder, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const { booking } = await res.json();
    expect(booking.status).toBe('PENDING');

    const incBefore = walletOf(SEED.incubatorUserId);
    const approve = await inc.patch(`/api/incubator/bookings/${booking.id}`, {
      data: { status: 'CONFIRMED' },
    });
    expect(approve.status(), `approve → ${approve.status()} ${await approve.text()}`).toBe(200);
    expect((await approve.json()).booking.status).toBe('CONFIRMED');

    expect(walletOf(SEED.incubatorUserId), 'incubator credited the booking total').toBe(
      incBefore + booking.totalAmount,
    );
  });

  // 2. Withdrawal: request holds escrow; admin approval is terminal.
  test('admin approves a withdrawal request (escrow held, re-decision rejected)', async () => {
    const before = await walletBalance(founder);
    const reqRes = await founder.post('/api/withdrawals', {
      data: { amount: 1000, accountDetails: 'CCP 0012345 67 QA' },
    });
    expect(reqRes.status(), `request → ${reqRes.status()} ${await reqRes.text()}`).toBe(201);
    const requestId = (await reqRes.json()).withdrawalRequest.id as string;
    expect(await walletBalance(founder), 'amount escrowed on request').toBe(before - 1000);

    const approve = await admin.patch(`/api/admin/withdrawals/${requestId}`, {
      data: { status: 'APPROVED', adminNote: 'QA approved' },
    });
    expect(approve.status(), `approve → ${approve.status()} ${await approve.text()}`).toBe(200);
    expect((await approve.json()).withdrawalRequest.status).toBe('APPROVED');
    // Funds already left the wallet at request time; approval doesn't refund.
    expect(await walletBalance(founder)).toBe(before - 1000);

    // A second decision on a resolved request is rejected.
    const again = await admin.patch(`/api/admin/withdrawals/${requestId}`, {
      data: { status: 'REJECTED' },
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).error?.code).toBe('ALREADY_RESOLVED');
  });

  // 3. Withdrawal reject → the escrowed amount is refunded.
  test('admin rejects a withdrawal request and the escrow is refunded', async () => {
    const before = await walletBalance(founder);
    const reqRes = await founder.post('/api/withdrawals', {
      data: { amount: 1500, accountDetails: 'BaridiMob 007788 QA' },
    });
    expect(reqRes.status()).toBe(201);
    const requestId = (await reqRes.json()).withdrawalRequest.id as string;
    expect(await walletBalance(founder)).toBe(before - 1500);

    const reject = await admin.patch(`/api/admin/withdrawals/${requestId}`, {
      data: { status: 'REJECTED', adminNote: 'QA rejected' },
    });
    expect(reject.status(), `reject → ${reject.status()} ${await reject.text()}`).toBe(200);
    expect((await reject.json()).withdrawalRequest.status).toBe('REJECTED');
    expect(await walletBalance(founder), 'escrow refunded on reject').toBe(before);
  });

  // 4. Promo code CRUD: create → list → update → deactivate.
  test('admin creates, lists, updates and deactivates a promo code', async () => {
    const code = `QA-CRUD-${Date.now()}`;

    // Create.
    const createRes = await admin.post('/api/admin/promo-codes', {
      data: { code, discountPercent: 20, appliesTo: 'SPACE', expiresAt: null, usageLimit: null },
    });
    expect(createRes.status(), `create → ${createRes.status()} ${await createRes.text()}`).toBe(201);
    const created = await createRes.json();
    expect(created.code).toBe(code.toUpperCase());
    expect(created.discountPercent).toBe(20);
    const id = created.id as string;

    // Read (list contains it).
    const list = await admin.get('/api/admin/promo-codes');
    expect(list.status()).toBe(200);
    const items = (await list.json()).items as Array<{ id: string }>;
    expect(items.some((c) => c.id === id), 'created code appears in the list').toBe(true);

    // Update the discount.
    const patch = await admin.patch(`/api/admin/promo-codes/${id}`, {
      data: { discountPercent: 35 },
    });
    expect(patch.status(), `update → ${patch.status()} ${await patch.text()}`).toBe(200);
    expect((await patch.json()).discountPercent).toBe(35);

    // Deactivate (soft-delete).
    const deactivate = await admin.patch(`/api/admin/promo-codes/${id}`, {
      data: { isActive: false },
    });
    expect(deactivate.status()).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);
  });
});
