/**
 * API-driven e2e: GUEST booking — both "book as guest" (no account) and
 * "book & create account" (password + email OTP → pay page), across the card
 * (space/program) and consultation surfaces.
 *
 *   book-as-guest:
 *     • space        — guest card intent (ONLINE_FULL) → hosted-checkout settle
 *     • program      — guest card intent (ONLINE_FULL) → hosted-checkout settle
 *     • consultation — guest instant-book → pay token → consultation pay settle
 *   book-&-create-account:
 *     • CARD  (space)        — signup-pending carries the card intent; OTP verify
 *                              attaches it to the new user → redirect to pay page
 *     • CONSULTATION         — guest consultation, then signup-pending links it
 *                              to the new account on OTP verify
 *
 * Payments run on the mock provider in SYNC mode, so a hosted-checkout `init`
 * settles inside the request. OTP is recovered from the local DB via _otp.ts.
 * Booking ownership/lifecycle is asserted from server state (local DB). Serial.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createSpace,
  createProgram,
  clientRef,
  xff,
  readLocalDb,
  findBookingByRef,
  futureWeekdayUtc,
  utcWindow,
} from './_helpers';
import {
  mintConsultantContext,
  setupMentorAvailability,
  nextUniqueSlot,
  instantBook,
  settleGuest,
  MENTOR_ID,
} from './_consult-helpers';
import { getSignupOtpByPendingId } from './_otp';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function freshPhone(): string {
  return `+2137${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}
function guestCustomer() {
  return { fullName: `QA Guest ${uniq()}`, email: `qa.guest.${uniq()}@metwork.test`, phone: freshPhone() };
}

/** Drive a card hosted-checkout to settlement (mock sync settles on init). */
async function settleCard(ctx: APIRequestContext, token: string): Promise<void> {
  const init = await ctx.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'init' } });
  expect(init.status(), `card pay init → ${init.status()} ${await init.text()}`).toBe(200);
  await ctx.post(`/api/bookings/pay/${token}`, { headers: xff(), data: { action: 'verify' } });
}

test.describe.serial('Guest booking', () => {
  let inc: APIRequestContext;
  let admin: APIRequestContext;
  let consultant: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    admin = await roleContext('admin');
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
  });
  test.afterAll(async () => {
    await inc.dispose();
    await admin.dispose();
    await consultant.dispose();
  });

  // ─── Book as guest ──────────────────────────────────────────────────────

  test('guest books a SPACE by card and settles (no account)', async () => {
    const space = await createSpace(inc, { workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(13);
    const { startsAt, endsAt } = utcWindow(day, 10, 12);
    const ref = clientRef('guest-space');

    const guest = await guestContext();
    try {
      const res = await guest.post('/api/bookings/card', {
        headers: xff(),
        data: {
          target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
          paymentMode: 'ONLINE_FULL',
          customer: guestCustomer(),
          clientReference: ref,
        },
      });
      expect(res.status(), `card intent → ${res.status()} ${await res.text()}`).toBe(201);
      const { token } = await res.json();
      await settleCard(guest, token);
    } finally {
      await guest.dispose();
    }

    const booking = findBookingByRef(ref);
    expect(booking, 'guest booking persisted').toBeTruthy();
    expect(booking!.userId, 'guest booking has no owner').toBeNull();
    expect(booking!.status).toBe('CONFIRMED');
    expect(booking!.paymentStatus).toBe('PAID');
  });

  test('guest books a PROGRAM by card and settles (no account)', async () => {
    const program = await createProgram(inc, { price: 4000, seatsTotal: 10 });
    const ref = clientRef('guest-prog');

    const guest = await guestContext();
    try {
      const res = await guest.post('/api/bookings/card', {
        headers: xff(),
        data: {
          target: { itemKind: 'PROGRAM', programId: program.id },
          paymentMode: 'ONLINE_FULL',
          customer: guestCustomer(),
          clientReference: ref,
        },
      });
      expect(res.status(), `card intent → ${res.status()} ${await res.text()}`).toBe(201);
      await settleCard(guest, (await res.json()).token);
    } finally {
      await guest.dispose();
    }

    const booking = findBookingByRef(ref);
    expect(booking?.status).toBe('CONFIRMED');
    expect(booking?.userId).toBeNull();
  });

  test('guest books a CONSULTATION (instant-book) and settles via the pay token', async () => {
    const guest = await guestContext();
    let bookingId: string;
    let payToken: string;
    try {
      const { date, time } = nextUniqueSlot();
      const res = await instantBook(guest, { date, time, durationMinutes: 60 });
      expect(res.status(), `guest instant-book → ${res.status()} ${await res.text()}`).toBe(201);
      const body = await res.json();
      expect(body.mode, 'guest must pay before confirm').toBe('awaiting_payment');
      bookingId = body.id;
      payToken = body.payToken;
      expect(payToken).toBeTruthy();
    } finally {
      await guest.dispose();
    }

    const settled = await settleGuest(payToken);
    expect(settled.initStatus, `guest pay init → ${settled.initStatus}`).toBeLessThan(400);

    const mb = readLocalDb().mentorBookings.find((b) => (b as { id: string }).id === bookingId) as
      | { status: string; source?: string; userId: string | null }
      | undefined;
    expect(mb, 'guest consultation persisted').toBeTruthy();
    expect(mb!.source).toBe('guest');
    expect(['CONFIRMED', 'READY', 'AWAITING_LINK'], `settled status → ${mb!.status}`).toContain(mb!.status);
  });

  // ─── Book & create account ──────────────────────────────────────────────

  test('book & create account (CARD space): signup-pending → email OTP → pay page attaches the booking', async () => {
    const space = await createSpace(inc, { workingDays: ALL_WEEK });
    const day = futureWeekdayUtc(14);
    const { startsAt, endsAt } = utcWindow(day, 13, 15);
    const ref = clientRef('acct-space');
    const cust = guestCustomer();
    const password = 'GuestAcct2026!';

    const guest = await guestContext();
    try {
      // 1. Create the pending account carrying the card booking intent.
      const pendingRes = await guest.post('/api/auth/signup-pending', {
        headers: xff(),
        data: {
          fullName: cust.fullName,
          email: cust.email,
          phone: cust.phone,
          password,
          confirmPassword: password,
          city: 'Alger',
          locale: 'en',
          intent: {
            kind: 'CARD',
            target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
            paymentMode: 'ONLINE_FULL',
            clientReference: ref,
          },
        },
      });
      expect(pendingRes.status(), `signup-pending → ${pendingRes.status()} ${await pendingRes.text()}`).toBe(201);
      const pendingId = (await pendingRes.json()).userId as string;

      // 2. Recover the email OTP and verify → account promoted + booking attached.
      const code = getSignupOtpByPendingId(pendingId);
      const verify = await guest.post('/api/auth/verify-otp', {
        headers: xff(),
        data: { userId: pendingId, code },
      });
      expect(verify.status(), `verify → ${verify.status()} ${await verify.text()}`).toBe(200);
      const vbody = await verify.json();
      const userId = vbody.user.id as string;
      expect(vbody.redirect, 'verify should redirect to the pay page').toContain('/booking/pay/');
      const payToken = String(vbody.redirect).split('/').pop()!;

      // The card booking is now owned by the freshly-created account.
      const attached = findBookingByRef(ref);
      expect(attached?.userId, 'booking re-assigned to the new account').toBe(userId);

      // 3. Pay → CONFIRMED.
      await settleCard(guest, payToken);
    } finally {
      await guest.dispose();
    }

    const booking = findBookingByRef(ref);
    expect(booking?.status).toBe('CONFIRMED');
  });

  test('book & create account (CONSULTATION): a guest request is linked to the new account on OTP verify', async () => {
    // 1. Guest consultation request (unclaimed, source=guest).
    const guest = await guestContext();
    let mentorBookingId: string;
    let payToken: string;
    const cust = guestCustomer();
    const password = 'GuestAcct2026!';
    try {
      const { date, time } = nextUniqueSlot();
      const res = await instantBook(guest, {
        date,
        time,
        durationMinutes: 60,
        email: cust.email,
        name: cust.fullName,
        phone: cust.phone,
      });
      expect(res.status(), `guest instant-book → ${res.status()} ${await res.text()}`).toBe(201);
      const body = await res.json();
      mentorBookingId = body.id;
      payToken = body.payToken;

      // 2. signup-pending CONSULTATION links the existing guest request.
      const pendingRes = await guest.post('/api/auth/signup-pending', {
        headers: xff(),
        data: {
          fullName: cust.fullName,
          email: cust.email,
          phone: cust.phone,
          password,
          confirmPassword: password,
          city: 'Alger',
          locale: 'en',
          intent: { kind: 'CONSULTATION', mentorBookingId },
        },
      });
      expect(pendingRes.status(), `signup-pending → ${pendingRes.status()} ${await pendingRes.text()}`).toBe(201);
      const pendingId = (await pendingRes.json()).userId as string;

      // 3. Verify OTP → account promoted + consultation re-assigned.
      const code = getSignupOtpByPendingId(pendingId);
      const verify = await guest.post('/api/auth/verify-otp', {
        headers: xff(),
        data: { userId: pendingId, code },
      });
      expect(verify.status(), `verify → ${verify.status()} ${await verify.text()}`).toBe(200);
      const userId = (await verify.json()).user.id as string;

      const mb = readLocalDb().mentorBookings.find((b) => (b as { id: string }).id === mentorBookingId) as
        | { userId: string | null; source?: string }
        | undefined;
      expect(mb?.userId, 'consultation linked to the new account').toBe(userId);
      expect(mb?.source).toBe('guest');
    } finally {
      await guest.dispose();
    }

    // 4. The pay link still settles the (now-linked) booking.
    const settled = await settleGuest(payToken);
    expect(settled.initStatus).toBeLessThan(400);
  });
});
