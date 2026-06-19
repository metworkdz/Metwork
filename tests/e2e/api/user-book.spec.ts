/**
 * API-driven e2e: registered USER booking matrix — the happy paths a member
 * drives from their wallet.
 *
 *   • space  FULL-DAY  (unit DAY)  — charged pricePerDay
 *   • space  HOURLY    (from–to)   — charged pricePerHour × hours
 *   • program apply    (paid)      — wallet debited by the program price
 *   • consultation     instant-book, full price AND with a promo discount —
 *     asserts the MEMBER wallet is debited by the server-computed amount.
 *
 * The actor is the seeded EXPLORER (no membership-tier discount on spaces/events
 * or consultations), so every amount is exact. Wallets are funded via the mock
 * SlickPay top-up (sync mode settles in-request). Money is asserted from server
 * state (booking/transaction/wallet), never from the request. Serial, workers:1.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createSpace,
  createProgram,
  bookSpace,
  applyToProgram,
  walletBalance,
  topUp,
  futureWeekdayUtc,
  utcWindow,
} from './_helpers';
import {
  mintConsultantContext,
  setupMentorAvailability,
  nextUniqueSlot,
  instantBook,
  getMentorFee,
  userWalletBalance,
  ensureConsultationPromo,
} from './_consult-helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

test.describe.serial('Registered user booking matrix', () => {
  let inc: APIRequestContext;
  let explorer: APIRequestContext;
  let admin: APIRequestContext;
  let consultant: APIRequestContext;
  let fee: number;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    explorer = await roleContext('explorer');
    admin = await roleContext('admin');
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
    fee = await getMentorFee(admin);
  });

  test.afterAll(async () => {
    await inc.dispose();
    await explorer.dispose();
    await admin.dispose();
    await consultant.dispose();
  });

  // 1. Space FULL-DAY booking, wallet-paid → charged pricePerDay.
  test('books a space for a FULL DAY and is charged pricePerDay', async () => {
    const space = await createSpace(inc, { pricePerHour: 500, pricePerDay: 3000, workingDays: ALL_WEEK });
    await topUp(explorer, 5000);

    const day = futureWeekdayUtc(11);
    const { startsAt, endsAt } = utcWindow(day, 9, 18);
    const res = await bookSpace(explorer, space.id, 'DAY', startsAt, endsAt, 'ONLINE');
    expect(res.status(), `book DAY → ${res.status()} ${await res.text()}`).toBe(201);

    const body = await res.json();
    expect(body.booking.totalAmount).toBe(3000);
    expect(body.booking.unit).toBe('DAY');
    expect(body.transaction.amount).toBe(-3000);
    expect(body.booking.status).toBe('PENDING'); // wallet booking awaits incubator confirm
  });

  // 2. Space HOURLY booking spanning 3 hours → charged pricePerHour × 3.
  test('books a space HOURLY (from–to) and is charged pricePerHour × hours', async () => {
    const space = await createSpace(inc, { pricePerHour: 500, pricePerDay: 3000, workingDays: ALL_WEEK });
    await topUp(explorer, 5000);

    const day = futureWeekdayUtc(12);
    const { startsAt, endsAt } = utcWindow(day, 10, 13); // 3 hours
    const res = await bookSpace(explorer, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
    expect(res.status(), `book HOUR → ${res.status()} ${await res.text()}`).toBe(201);

    const body = await res.json();
    expect(body.booking.quantity).toBe(3);
    expect(body.booking.totalAmount).toBe(1500);
    expect(body.transaction.amount).toBe(-1500);
  });

  // 3. Program application, wallet-paid → wallet debited by the program price.
  test('applies to a paid program and the wallet is debited by the program price', async () => {
    const program = await createProgram(inc, { price: 2000, seatsTotal: 10 });
    await topUp(explorer, 5000);

    const before = await walletBalance(explorer);
    const res = await applyToProgram(explorer, program.id, 'ONLINE');
    expect(res.status(), `apply → ${res.status()} ${await res.text()}`).toBe(201);
    const after = await walletBalance(explorer);
    expect(before - after, 'wallet debited by exactly the program price').toBe(2000);
  });

  // 4. Consultation instant-book at FULL price → member wallet debited by fee.
  test('books a consultation at full price and the member wallet is debited by the fee', async () => {
    await topUp(explorer, fee * 2);
    const before = await userWalletBalance(explorer);

    const { date, time } = nextUniqueSlot();
    const res = await instantBook(explorer, { date, time, durationMinutes: 60 });
    expect(res.status(), `instant-book → ${res.status()} ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body.mode, 'funded member books straight to confirmed').toBe('confirmed');

    const after = await userWalletBalance(explorer);
    expect(before - after, 'member charged exactly the 60-min fee').toBe(fee);
  });

  // 5. Consultation instant-book WITH a promo → member wallet debited by fee − promo.
  test('books a consultation with a promo and the member wallet is debited by the discounted amount', async () => {
    const promo = await ensureConsultationPromo(admin, 30);
    const expectedCharge = fee - Math.round((fee * 30) / 100);

    await topUp(explorer, fee * 2);
    const before = await userWalletBalance(explorer);

    const { date, time } = nextUniqueSlot();
    const res = await instantBook(explorer, { date, time, durationMinutes: 60, promoCode: promo });
    expect(res.status(), `instant-book (promo) → ${res.status()} ${await res.text()}`).toBe(201);
    expect((await res.json()).mode).toBe('confirmed');

    const after = await userWalletBalance(explorer);
    expect(before - after, 'member charged base − 30% promo').toBe(expectedCharge);
  });
});
