/**
 * API-driven e2e: PAYMENTS & money lifecycle.
 *
 *   1. Wallet top-up via the mock SlickPay provider (sync settle).
 *   2. Charge wallet on a booking (debit equals the server total).
 *   3. Idempotent booking replay — same clientReference never double-charges.
 *   4. Card CASH_DEPOSIT lifecycle — AWAITING_CASH → mark-cash-paid → PAID.
 *   5. Guest tokenized card link settles, and a replayed verify does NOT
 *      double-credit the incubator (idempotent settlement).
 *   6. Promo code: 100% → 0 DZD auto-confirms a consultation.
 *   7. Decline → refund: consultant cancel refunds once; a replay never
 *      double-refunds.
 *
 * Money is asserted from server state (wallet balances / booking lifecycle in
 * the local DB), never from a single response DTO. Mock provider in SYNC mode.
 * Serial under playwright.api.config.ts (workers:1).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createSpace,
  bookSpace,
  walletBalance,
  topUp,
  clientRef,
  xff,
  readLocalDb,
  findBookingByRef,
  futureWeekdayUtc,
  utcWindow,
  SEED,
} from './_helpers';
import {
  mintConsultantContext,
  setupMentorAvailability,
  nextUniqueSlot,
  instantBook,
  ensureConsultationPromo,
  userWalletBalance,
} from './_consult-helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

/** Read a wallet balance straight from server state, by userId (0 if none). */
function walletOf(userId: string): number {
  const w = readLocalDb().wallets.find((x) => x.userId === userId);
  return w ? w.balance : 0;
}

test.describe.serial('Payments & money lifecycle', () => {
  let inc: APIRequestContext;
  let admin: APIRequestContext;
  let founder: APIRequestContext;
  let explorer: APIRequestContext;
  let consultant: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    admin = await roleContext('admin');
    founder = await roleContext('founder');
    explorer = await roleContext('explorer');
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
    // Fund the founder wallet once (top-up is rate-limited 10/user/hour).
    await topUp(founder, 300_000);
  });
  test.afterAll(async () => {
    await inc.dispose();
    await admin.dispose();
    await founder.dispose();
    await explorer.dispose();
    await consultant.dispose();
  });

  // 1. Wallet top-up settles synchronously and credits the balance.
  test('wallet top-up via the mock provider settles and credits the balance', async () => {
    const before = await walletBalance(founder);
    const newBalance = await topUp(founder, 5000);
    expect(newBalance, 'top-up returns the post-credit balance').toBe(before + 5000);
    expect(await walletBalance(founder), 'balance persisted').toBe(before + 5000);
  });

  // 2. Booking debits the wallet by exactly the server-computed total.
  test('booking a space charges the wallet by the server total', async () => {
    const space = await createSpace(inc, { pricePerHour: 600, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(15);
    const { startsAt, endsAt } = utcWindow(day, 9, 11);

    const before = await walletBalance(founder);
    const res = await bookSpace(founder, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const body = await res.json();
    const after = await walletBalance(founder);

    expect(body.transaction.amount).toBe(-body.booking.totalAmount);
    expect(before - after, 'wallet debited by exactly the booking total').toBe(body.booking.totalAmount);
  });

  // 3. Replaying a booking (same clientReference) never double-charges.
  test('replaying a booking with the same clientReference does not double-charge', async () => {
    const space = await createSpace(inc, { pricePerHour: 700, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(16);
    const { startsAt, endsAt } = utcWindow(day, 9, 10);
    const ref = clientRef('replay');

    const before = await walletBalance(founder);
    const first = await bookSpace(founder, space.id, 'HOUR', startsAt, endsAt, 'ONLINE', ref);
    expect(first.status()).toBe(201);
    const charged = before - (await walletBalance(founder));
    expect(charged).toBe(700);

    // Replay → 200 + replayed flag, wallet untouched the second time.
    const replay = await bookSpace(founder, space.id, 'HOUR', startsAt, endsAt, 'ONLINE', ref);
    expect(replay.status(), 'replay returns 200').toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(await walletBalance(founder), 'no second debit').toBe(before - 700);
  });

  // 4. Card CASH_DEPOSIT → AWAITING_CASH, then mark-cash-paid → PAID (idempotent).
  test('a card CASH_DEPOSIT booking lands AWAITING_CASH and mark-cash-paid settles it to PAID', async () => {
    // Space that accepts CASH with a 50% online deposit.
    const created = await inc.post('/api/incubator/spaces', {
      data: {
        name: `QA Cash Space ${Date.now().toString(36)}`,
        description: 'Automated e2e cash-deposit fixture. Safe to delete.',
        category: 'COWORKING',
        city: 'Alger',
        pricePerHour: 1000,
        pricePerDay: 6000,
        capacity: 20,
        amenities: ['wifi'],
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        cashDepositType: 'PERCENT',
        cashDepositValue: 50,
        workingDays: ALL_WEEK,
        openingTime: '09:00',
        closingTime: '18:00',
      },
    });
    expect(created.status(), `create cash space → ${created.status()} ${await created.text()}`).toBe(201);
    const space = await created.json();

    const day = futureWeekdayUtc(17);
    const { startsAt, endsAt } = utcWindow(day, 10, 12); // 2 hours → T = 2000
    const ref = clientRef('cashdep');

    const guest = await guestContext();
    try {
      const intent = await guest.post('/api/bookings/card', {
        headers: xff(),
        data: {
          target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
          paymentMode: 'CASH_DEPOSIT',
          customer: { fullName: 'QA Cash Guest', email: `qa.cash.${Date.now()}@metwork.test`, phone: '+213700112255' },
          clientReference: ref,
        },
      });
      expect(intent.status(), `cash intent → ${intent.status()} ${await intent.text()}`).toBe(201);
      const { token } = await intent.json();
      const init = await guest.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'init' } });
      expect(init.status()).toBe(200);
    } finally {
      await guest.dispose();
    }

    // Settled card deposit → CONFIRMED + AWAITING_CASH; T − D still due.
    const booking = findBookingByRef(ref);
    expect(booking, 'cash-deposit booking persisted').toBeTruthy();
    expect(booking!.status).toBe('CONFIRMED');
    expect(booking!.paymentStatus).toBe('AWAITING_CASH');
    expect(booking!.onlinePaidAmount, 'deposit = 50% of 2000').toBe(1000);
    expect(booking!.cashRemainingAmount, 'cash balance = 1000').toBe(1000);

    // Incubator collects the cash balance.
    const paid = await inc.patch(`/api/incubator/bookings/${booking!.id}/mark-cash-paid`);
    expect(paid.status(), `mark-cash-paid → ${paid.status()} ${await paid.text()}`).toBe(200);
    expect((await paid.json()).booking.paymentStatus).toBe('PAID');

    // Idempotent: marking again stays PAID, no error.
    const again = await inc.patch(`/api/incubator/bookings/${booking!.id}/mark-cash-paid`);
    expect(again.status()).toBe(200);
    expect((await again.json()).booking.paymentStatus).toBe('PAID');
  });

  // 5. Guest tokenized ONLINE_FULL link settles, and replaying verify never
  //    double-credits the incubator (idempotent settlement).
  test('a settled card booking is not re-credited to the incubator on a replayed verify', async () => {
    const space = await createSpace(inc, { pricePerHour: 900, workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(18);
    const { startsAt, endsAt } = utcWindow(day, 9, 11);
    const ref = clientRef('idem-card');

    const incBefore = walletOf(SEED.incubatorUserId);

    const guest = await guestContext();
    try {
      const intent = await guest.post('/api/bookings/card', {
        headers: xff(),
        data: {
          target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
          paymentMode: 'ONLINE_FULL',
          customer: { fullName: 'QA Idem Guest', email: `qa.idem.${Date.now()}@metwork.test`, phone: '+213700112266' },
          clientReference: ref,
        },
      });
      expect(intent.status()).toBe(201);
      const { token } = await intent.json();

      const init = await guest.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'init' } });
      expect(init.status()).toBe(200);
      const incAfterSettle = walletOf(SEED.incubatorUserId);
      expect(incAfterSettle, 'incubator credited on settlement').toBeGreaterThan(incBefore);

      // Replay verify twice — settlement is idempotent, balance must not move.
      await guest.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'verify' } });
      await guest.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'verify' } });
      expect(walletOf(SEED.incubatorUserId), 'no double-credit on replay').toBe(incAfterSettle);
    } finally {
      await guest.dispose();
    }

    expect(findBookingByRef(ref)?.status).toBe('CONFIRMED');
  });

  // 6. A 100% promo settles a consultation to 0 DZD and auto-confirms it.
  test('a 100% promo auto-confirms a consultation at 0 DZD', async () => {
    const promo = await ensureConsultationPromo(admin, 100);
    const before = await userWalletBalance(explorer);

    const { date, time } = nextUniqueSlot();
    const res = await instantBook(explorer, { date, time, durationMinutes: 60, promoCode: promo });
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.mode, 'zero-amount booking auto-confirms').toBe('confirmed');

    expect(await userWalletBalance(explorer), 'no wallet charge for a 0 DZD booking').toBe(before);
  });

  // 7. Decline → refund: consultant cancel refunds the member once; replay no-ops.
  test('cancelling a member consultation refunds once and never double-refunds', async () => {
    const beforeBook = await walletBalance(founder);
    const { date, time } = nextUniqueSlot();
    const res = await instantBook(founder, { date, time, durationMinutes: 60 });
    expect(res.status(), `book → ${res.status()} ${await res.text()}`).toBe(201);
    const { id, mode } = await res.json();
    expect(mode).toBe('confirmed');

    const afterBook = await walletBalance(founder);
    const charged = beforeBook - afterBook;
    expect(charged, 'member was charged for the consultation').toBeGreaterThan(0);

    // Consultant cancels → full refund to the member wallet.
    const cancel = await consultant.post(`/api/consultant/bookings/${id}/cancel`, {
      data: { reason: 'QA automated cancel' },
    });
    expect(cancel.status(), `cancel → ${cancel.status()} ${await cancel.text()}`).toBe(200);
    const cbody = await cancel.json();
    expect(cbody.status).toBe('CANCELLED');
    expect(cbody.refundedAmount, 'refund equals the charge').toBe(charged);
    expect(await walletBalance(founder), 'wallet made whole').toBe(beforeBook);

    // Replay the cancel → no second refund.
    const replay = await consultant.post(`/api/consultant/bookings/${id}/cancel`, { data: {} });
    expect(replay.status()).toBe(200);
    const rbody = await replay.json();
    expect(rbody.replayed, 'second cancel is a replay').toBe(true);
    expect(rbody.refundedAmount).toBe(0);
    expect(await walletBalance(founder), 'no double-refund').toBe(beforeBook);
  });
});
