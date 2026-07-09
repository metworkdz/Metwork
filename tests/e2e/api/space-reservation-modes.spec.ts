/**
 * Space reservation modes (Airbnb-style) — INSTANT vs REQUEST, API-driven.
 *
 * Asserts MONEY MOVEMENT, not just labels:
 *   - INSTANT: debit at reservation, auto-CONFIRMED, incubator credited, no
 *     approval step.
 *   - REQUEST: no debit at reservation (AWAITING_APPROVAL soft-holds the
 *     seat) → incubator approves (APPROVED_UNPAID, still no money) → client
 *     pays via the tokenized link (CONFIRMED, debit + incubator credit) —
 *     idempotent on replay.
 *   - Decline releases the seat with no charge.
 *
 * Uses the EXPLORER user (no membership space discount → clean amounts) and
 * reads the tokenized pay link from the e2e email sink — the DB stores only
 * the token hash, so the sink is the only place the raw link exists (exactly
 * like a real client's inbox).
 *
 * SERIAL & state-sharing (one local JSON doc): run with `--workers=1`:
 *   npx playwright test --project=space-reservation-modes --workers=1
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createSpace,
  bookSpace,
  topUp,
  walletBalance,
  clientRef,
  futureWeekdayUtc,
  utcWindow,
  lastPayLinkFor,
  countSinkEmails,
} from './_helpers';

test.describe.configure({ mode: 'serial' });

let inc: APIRequestContext;
let user: APIRequestContext;

test.beforeAll(async () => {
  inc = await roleContext('incubator');
  user = await roleContext('explorer');
  // Fund the client once for the whole suite (mock provider, settles in-request).
  await topUp(user, 20_000);
});

test.afterAll(async () => {
  await inc.dispose();
  await user.dispose();
});

/** Fresh single-capacity space; TRAINING_ROOM keeps desk semantics out. */
function newSpace(reservationMode: 'INSTANT' | 'REQUEST') {
  return createSpace(inc, { reservationMode, category: 'TRAINING_ROOM', capacity: 1, pricePerHour: 500 });
}

/** Book a 2-hour window (2 × 500 = 1000 DZD) `daysAhead` weekdays out. */
function bookWindow(daysAhead: number) {
  return utcWindow(futureWeekdayUtc(daysAhead), 10, 12);
}

test('INSTANT: debit at reservation, auto-confirmed, incubator credited, no approval step', async () => {
  const space = await newSpace('INSTANT');
  const { startsAt, endsAt } = bookWindow(4);

  const userBefore = await walletBalance(user);
  const incBefore = await walletBalance(inc);

  const res = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
  expect(res.status(), await res.text()).toBe(201);
  const { booking } = await res.json();

  // Confirmed immediately — no incubator action of any kind.
  expect(booking.status).toBe('CONFIRMED');
  expect(booking.totalAmount).toBe(1000);

  // Money moved BOTH ways atomically: client debited, incubator credited.
  expect(await walletBalance(user)).toBe(userBefore - 1000);
  expect(await walletBalance(inc)).toBe(incBefore + 1000);
});

test('REQUEST: no debit until approval, then payment link, then confirmed (idempotent)', async () => {
  const space = await newSpace('REQUEST');
  const { startsAt, endsAt } = bookWindow(6);

  // 1) Reserve — NO money moves.
  const userAfterTopUp = await walletBalance(user);
  const incStart = await walletBalance(inc);

  const res = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
  expect(res.status(), await res.text()).toBe(201);
  const { booking } = await res.json();
  expect(booking.status).toBe('AWAITING_APPROVAL');
  expect(await walletBalance(user)).toBe(userAfterTopUp); // unchanged — no debit

  // Soft-hold: a second user cannot book the same single-capacity slot while
  // the request is pending.
  const overlap = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE', clientRef('ovl'));
  expect(overlap.status()).toBe(409);

  // 2) Incubator approves — APPROVED_UNPAID, still no money anywhere.
  const approve = await inc.patch(`/api/incubator/bookings/${booking.id}`, {
    data: { status: 'CONFIRMED' },
  });
  expect(approve.status(), await approve.text()).toBe(200);
  const approved = (await approve.json()).booking;
  expect(approved.status).toBe('APPROVED_UNPAID');
  // The raw pay token must never surface in the incubator's API response.
  expect(approved.requestApproval).toBeUndefined();
  expect(approved.paymentLinkTokenHash).toBeUndefined();
  expect(await walletBalance(user)).toBe(userAfterTopUp);
  expect(await walletBalance(inc)).toBe(incStart);

  // Idempotent re-approve: state unchanged, no second pay-link email.
  const reApprove = await inc.patch(`/api/incubator/bookings/${booking.id}`, {
    data: { status: 'CONFIRMED' },
  });
  expect(reApprove.status()).toBe(200);
  expect((await reApprove.json()).booking.status).toBe('APPROVED_UNPAID');
  expect(countSinkEmails('booking-approved-pay-link', booking.id)).toBe(1);

  // 3) Client pays via the tokenized link from the (sink) email.
  const link = lastPayLinkFor(booking.id);
  expect(link, 'pay link should have been recorded by the e2e email sink').toBeTruthy();

  // Wrong token is rejected with no state change.
  const badPay = await user.post(`/api/bookings/${booking.id}/pay`, {
    data: { token: 'not-the-right-token-000000000000' },
  });
  expect(badPay.status()).toBe(403);
  expect(await walletBalance(user)).toBe(userAfterTopUp);

  const pay = await user.post(`/api/bookings/${booking.id}/pay`, { data: { token: link!.token } });
  expect(pay.status(), await pay.text()).toBe(200);
  const paid = (await pay.json()).booking;
  expect(paid.status).toBe('CONFIRMED');

  // 4) Money moved exactly once: client −1000, incubator +1000.
  const userAfterPay = await walletBalance(user);
  const incAfterPay = await walletBalance(inc);
  expect(userAfterPay).toBe(userAfterTopUp - 1000);
  expect(incAfterPay).toBe(incStart + 1000);

  // 5) Idempotency: replaying the pay call does not double-charge or
  //    double-credit — it returns the already-confirmed result.
  const replay = await user.post(`/api/bookings/${booking.id}/pay`, { data: { token: link!.token } });
  expect(replay.status(), await replay.text()).toBe(200);
  const replayBody = await replay.json();
  expect(replayBody.alreadyPaid).toBe(true);
  expect(replayBody.booking.status).toBe('CONFIRMED');
  expect(await walletBalance(user)).toBe(userAfterPay);
  expect(await walletBalance(inc)).toBe(incAfterPay);
});

test('REQUEST: insufficient balance returns needsTopUp with NO state change', async () => {
  const space = await createSpace(inc, {
    reservationMode: 'REQUEST',
    category: 'TRAINING_ROOM',
    capacity: 1,
    pricePerHour: 9_000_000, // far beyond the funded balance
  });
  const { startsAt, endsAt } = bookWindow(8);

  const before = await walletBalance(user);
  const res = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
  expect(res.status(), await res.text()).toBe(201); // request itself is free
  const { booking } = await res.json();
  expect(booking.status).toBe('AWAITING_APPROVAL');

  const approve = await inc.patch(`/api/incubator/bookings/${booking.id}`, {
    data: { status: 'CONFIRMED' },
  });
  expect(approve.status()).toBe(200);

  const link = lastPayLinkFor(booking.id);
  expect(link).toBeTruthy();

  const pay = await user.post(`/api/bookings/${booking.id}/pay`, { data: { token: link!.token } });
  expect(pay.status()).toBe(422);
  const body = await pay.json();
  expect(body.error?.code ?? body.code).toBe('INSUFFICIENT_FUNDS');

  // Nothing moved, booking still payable after a top-up.
  expect(await walletBalance(user)).toBe(before);
});

test('REQUEST: decline releases the seat, no charge', async () => {
  const space = await newSpace('REQUEST');
  const { startsAt, endsAt } = bookWindow(10);

  const before = await walletBalance(user);
  const incBefore = await walletBalance(inc);

  const res = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
  expect(res.status(), await res.text()).toBe(201);
  const { booking } = await res.json();
  expect(booking.status).toBe('AWAITING_APPROVAL');

  const decline = await inc.patch(`/api/incubator/bookings/${booking.id}`, {
    data: { status: 'CANCELLED', declineReason: 'Space unavailable' },
  });
  expect(decline.status(), await decline.text()).toBe(200);
  const declined = (await decline.json()).booking;
  expect(declined.status).toBe('CANCELLED');
  expect(declined.declineReason).toBe('Space unavailable');

  // Never charged, never credited — nothing to refund.
  expect(await walletBalance(user)).toBe(before);
  expect(await walletBalance(inc)).toBe(incBefore);

  // Seat is released: the same single-capacity window is bookable again.
  const rebook = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE', clientRef('rebook'));
  expect(rebook.status(), await rebook.text()).toBe(201);
  expect((await rebook.json()).booking.status).toBe('AWAITING_APPROVAL');
});

test('legacy (unset mode): behavior untouched — escrow debit at booking, PENDING status', async () => {
  const space = await createSpace(inc, { category: 'TRAINING_ROOM', capacity: 1, pricePerHour: 500 });
  const { startsAt, endsAt } = bookWindow(12);

  const before = await walletBalance(user);
  const res = await bookSpace(user, space.id, 'HOUR', startsAt, endsAt, 'ONLINE');
  expect(res.status(), await res.text()).toBe(201);
  const { booking } = await res.json();

  // Exactly the pre-feature behavior: escrowed debit, PENDING until the
  // incubator's manual confirmation.
  expect(booking.status).toBe('PENDING');
  expect(await walletBalance(user)).toBe(before - 1000);
});
