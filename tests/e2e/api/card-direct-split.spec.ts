/**
 * API-driven e2e: DIRECT card payment (Prompt 2) — full online + 50/50 split.
 *
 *   FULL (ONLINE_FULL): intent → hosted-checkout settle → booking PAID, the FULL
 *     receipt is dispatched exactly once, NO interim deposit receipt; replaying
 *     the success URL never re-settles or double-credits the incubator.
 *
 *   SPLIT (CASH_DEPOSIT, splitHalf): intent → settle → AWAITING_CASH with the
 *     online deposit + cash balance correct and the INTERIM deposit receipt sent
 *     (no final yet); incubator "mark cash received" → PAID + the FINAL receipt;
 *     replaying the success URL after settlement does not double-settle.
 *
 * "Receipt dispatched exactly once" is asserted from the booking's dedup stamps
 * (depositReceiptSentAt / finalReceiptSentAt) in server state — the same claim
 * the dispatcher uses — so we never depend on capturing a console log. Mock
 * provider in SYNC mode; account-only card flow driven by the seeded explorer
 * (no membership discount → predictable totals). Serial (workers:1).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createSpace,
  cardIntent,
  settleCard,
  payCard,
  clientRef,
  findBookingByRef,
  readLocalDb,
  futureWeekdayUtc,
  utcWindow,
  SEED,
} from './_helpers';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

/** Incubator manager wallet balance straight from server state (0 if none). */
function incBalance(): number {
  const w = readLocalDb().wallets.find((x) => x.userId === SEED.incubatorUserId);
  return w ? w.balance : 0;
}

function customer(tag: string) {
  return { fullName: `QA ${tag}`, email: `qa.${tag}.${Date.now()}@metwork.test`, phone: '+213700113344' };
}

test.describe.serial('Direct card payment — full & split', () => {
  let inc: APIRequestContext;
  let explorer: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    explorer = await roleContext('explorer');
  });
  test.afterAll(async () => {
    await inc.dispose();
    await explorer.dispose();
  });

  test('FULL online: settles to PAID, sends the final receipt once, never double-credits on replay', async () => {
    const space = await createSpace(inc, { pricePerHour: 800, workingDays: ALL_WEEK });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(20), 9, 11); // 2h → T = 1600
    const ref = clientRef('full');

    const before = incBalance();
    const intent = await cardIntent(explorer, {
      target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
      paymentMode: 'ONLINE_FULL',
      customer: customer('full'),
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    await settleCard(explorer, token);

    const b = findBookingByRef(ref)!;
    expect(b, 'booking persisted').toBeTruthy();
    expect(b.status).toBe('CONFIRMED');
    expect(b.paymentStatus, 'full online → PAID').toBe('PAID');
    expect(b.onlinePaidAmount, 'whole total paid online').toBe(b.totalAmount);
    expect(b.cashRemainingAmount ?? 0, 'nothing due in cash').toBe(0);
    // Final receipt dispatched exactly once; no interim deposit receipt for a full pay.
    expect(b.finalReceiptSentAt, 'final receipt dispatched').toBeTruthy();
    expect(b.depositReceiptSentAt ?? null, 'no deposit receipt on a full payment').toBeNull();

    const afterSettle = incBalance();
    expect(afterSettle, 'incubator credited on settlement').toBeGreaterThan(before);
    const finalStamp = b.finalReceiptSentAt;
    const settledStamp = b.settledAt;

    // Replay the success URL twice — idempotent: no re-settle, no re-credit, no re-send.
    await payCard(explorer, token, 'verify');
    await payCard(explorer, token, 'verify');
    const after = findBookingByRef(ref)!;
    expect(after.settledAt, 'settledAt unchanged').toBe(settledStamp);
    expect(after.finalReceiptSentAt, 'receipt not re-sent').toBe(finalStamp);
    expect(incBalance(), 'no double-credit on replay').toBe(afterSettle);
  });

  test('SPLIT 50/50: AWAITING_CASH + interim receipt; mark-cash-paid → PAID + final receipt; replay never double-settles', async () => {
    // Accepts CASH with a configured 50% deposit → online deposit = half the total.
    const space = await createSpace(inc, {
      pricePerHour: 1000,
      workingDays: ALL_WEEK,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 50,
    });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(21), 10, 12); // 2h → T = 2000
    const ref = clientRef('split');

    const before = incBalance();
    const intent = await cardIntent(explorer, {
      target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
      paymentMode: 'CASH_DEPOSIT',
      customer: customer('split'),
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    await settleCard(explorer, token);

    const b = findBookingByRef(ref)!;
    expect(b.status).toBe('CONFIRMED');
    expect(b.paymentStatus, 'deposit settled → awaiting cash').toBe('AWAITING_CASH');
    expect(b.onlinePaidAmount, 'deposit = 50% of 2000').toBe(1000);
    expect(b.cashRemainingAmount, 'cash balance = 1000').toBe(1000);
    expect((b.onlinePaidAmount ?? 0) + (b.cashRemainingAmount ?? 0), 'split sums to the total').toBe(b.totalAmount);
    // Interim deposit receipt sent; final NOT yet (balance still due).
    expect(b.depositReceiptSentAt, 'interim deposit receipt dispatched').toBeTruthy();
    expect(b.finalReceiptSentAt ?? null, 'no final receipt until paid in full').toBeNull();

    const afterDeposit = incBalance();
    expect(afterDeposit, 'incubator credited the online deposit').toBeGreaterThan(before);
    const depositStamp = b.depositReceiptSentAt;
    const settledStamp = b.settledAt;

    // Incubator collects the cash balance → PAID + final receipt.
    const paid = await inc.patch(`/api/incubator/bookings/${b.id}/mark-cash-paid`);
    expect(paid.status(), `mark-cash-paid → ${paid.status()} ${await paid.text()}`).toBe(200);
    expect((await paid.json()).booking.paymentStatus).toBe('PAID');

    const afterCash = findBookingByRef(ref)!;
    expect(afterCash.paymentStatus).toBe('PAID');
    expect(afterCash.finalReceiptSentAt, 'final receipt dispatched on cash collection').toBeTruthy();
    expect(afterCash.depositReceiptSentAt, 'deposit receipt stamp unchanged').toBe(depositStamp);
    // Marking cash paid moves NO wallet money (commission already taken on the deposit).
    expect(incBalance(), 'no wallet movement on cash collection').toBe(afterDeposit);

    // Replay the success URL after settlement → no re-settle, no re-credit.
    await payCard(explorer, token, 'verify');
    const replay = findBookingByRef(ref)!;
    expect(replay.settledAt, 'settledAt unchanged on replay').toBe(settledStamp);
    expect(incBalance(), 'no double-credit on replay').toBe(afterDeposit);
  });
});
