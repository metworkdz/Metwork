/**
 * API-driven e2e: PUBLIC space booking-INTENT carry-through (Prompt 5).
 *
 * The NEW "book before you sign up" flow (distinct from the signup-pending
 * embedded-intent path in guest-book.spec.ts): a logged-out visitor persists
 * ONLY their selection (date/time + payment option) via POST /api/bookings/intent,
 * carries the intent id through auth, then POST /api/bookings/intent/:id/resume
 * re-prices + re-checks availability and mints the pay token.
 *
 *   • SIGNUP path  — guest selects (split) → signup → email OTP verify → resume
 *                    lands on the pay step with the ORIGINAL selection applied,
 *                    owned by the freshly-created account.
 *   • LOGIN path   — guest selects → an existing member resumes → same.
 *   • TAKEN SLOT   — the slot is filled between selection and resume → resume is
 *                    rejected cleanly (409 SLOT_UNAVAILABLE), nothing booked.
 *
 * OTP recovered from the local DB (_otp.ts). Mock provider (no settlement here —
 * we assert the intent resumes to a pay token with the right frozen selection).
 * Serial (workers:1).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createSpace,
  manualBooking,
  createSpaceBookingIntent,
  resumeBookingIntent,
  clientRef,
  xff,
  findBookingByPayToken,
  futureWeekdayUtc,
  utcWindow,
  SEED,
} from './_helpers';
import { getSignupOtpByPendingId } from './_otp';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function freshPhone(): string {
  return `+2137${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

/** POST /api/auth/signup (ENTREPRENEUR) → pending user id. */
async function signupPending(ctx: APIRequestContext, email: string): Promise<string> {
  const password = 'GuestIntent2026!';
  const res = await ctx.post('/api/auth/signup', {
    headers: xff(),
    data: {
      role: 'ENTREPRENEUR',
      fullName: `QA Intent ${uniq()}`,
      email,
      phone: freshPhone(),
      city: 'Alger',
      password,
      confirmPassword: password,
      acceptTerms: true,
      acceptPrivacy: true,
    },
  });
  expect(res.status(), `signup → ${res.status()} ${await res.text()}`).toBe(201);
  return (await res.json()).userId as string;
}

/** Extract the pay token from a resume `payPath` like `/fr/booking/pay/<token>`. */
function tokenFromPayPath(payPath: string): string {
  return payPath.split('/').filter(Boolean).pop()!;
}

test.describe.serial('Public space booking-intent carry-through', () => {
  let inc: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
  });
  test.afterAll(async () => {
    await inc.dispose();
  });

  test('SIGNUP: guest selection (split) survives signup + OTP and resumes to the pay step', async () => {
    const space = await createSpace(inc, {
      pricePerHour: 1000,
      workingDays: ALL_WEEK,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 50,
    });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(24), 9, 11); // 2h → T = 2000

    // 1. Logged-out: persist the selection (CASH_DEPOSIT → 50% online deposit).
    const guest = await guestContext();
    let userId: string;
    let payToken: string;
    try {
      const intentRes = await createSpaceBookingIntent(guest, {
        spaceId: space.id,
        unit: 'HOUR',
        startsAt,
        endsAt,
        paymentMode: 'CASH_DEPOSIT',
      });
      expect(intentRes.status(), `intent → ${intentRes.status()} ${await intentRes.text()}`).toBe(201);
      const intentId = (await intentRes.json()).id as string;

      // 2. Sign up + verify the email OTP → session established on this context.
      const email = `qa.intent.${uniq()}@metwork.test`;
      const pendingId = await signupPending(guest, email);
      const code = getSignupOtpByPendingId(pendingId);
      const verify = await guest.post('/api/auth/verify-otp', { headers: xff(), data: { userId: pendingId, code } });
      expect(verify.status(), `verify → ${verify.status()} ${await verify.text()}`).toBe(200);
      userId = (await verify.json()).user.id as string;

      // 3. Resume → pay step, carrying the exact original selection.
      const resume = await resumeBookingIntent(guest, intentId);
      expect(resume.status(), `resume → ${resume.status()} ${await resume.text()}`).toBe(200);
      const payPath = (await resume.json()).payPath as string;
      expect(payPath, 'resume lands on the pay step').toContain('/booking/pay/');
      payToken = tokenFromPayPath(payPath);
    } finally {
      await guest.dispose();
    }

    const b = findBookingByPayToken(payToken)!;
    expect(b, 'card booking minted from the intent').toBeTruthy();
    expect(b.userId, 'owned by the freshly-created account').toBe(userId);
    expect(b.itemId).toBe(space.id);
    expect(b.unit).toBe('HOUR');
    expect(b.startsAt).toBe(startsAt);
    expect(b.endsAt).toBe(endsAt);
    expect(b.paymentMode, 'split selection preserved').toBe('CASH_DEPOSIT');
    expect(b.status).toBe('PENDING_PAYMENT'); // not paid yet — sits on the pay page
    expect(b.onlinePaidAmount, '50% deposit frozen server-side').toBe(1000);
    expect(b.cashRemainingAmount, '50% cash balance').toBe(1000);
  });

  test('LOGIN: an existing member resumes the carried selection', async () => {
    const explorer = await roleContext('explorer');
    const space = await createSpace(inc, { pricePerHour: 700, workingDays: ALL_WEEK });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(25), 9, 10); // 1h → T = 700

    let payToken: string;
    try {
      // Selection made while logged out.
      const guest = await guestContext();
      let intentId: string;
      try {
        const intentRes = await createSpaceBookingIntent(guest, {
          spaceId: space.id,
          unit: 'HOUR',
          startsAt,
          endsAt,
          paymentMode: 'ONLINE_FULL',
        });
        expect(intentRes.status()).toBe(201);
        intentId = (await intentRes.json()).id as string;
      } finally {
        await guest.dispose();
      }

      // The visitor logs in (existing account) and resumes.
      const resume = await resumeBookingIntent(explorer, intentId);
      expect(resume.status(), `resume → ${resume.status()} ${await resume.text()}`).toBe(200);
      payToken = tokenFromPayPath((await resume.json()).payPath as string);
    } finally {
      await explorer.dispose();
    }

    const b = findBookingByPayToken(payToken)!;
    expect(b.userId, 'owned by the logged-in member').toBe(SEED.explorerId);
    expect(b.itemId).toBe(space.id);
    expect(b.startsAt).toBe(startsAt);
    expect(b.paymentMode).toBe('ONLINE_FULL');
  });

  test('TAKEN SLOT: a selection whose slot fills before resume is rejected (409)', async () => {
    const explorer = await roleContext('explorer');
    // Capacity 1 → any overlap is a hard conflict.
    const space = await createSpace(inc, { pricePerHour: 800, capacity: 1, workingDays: ALL_WEEK });
    const { startsAt, endsAt } = utcWindow(futureWeekdayUtc(26), 9, 11);

    try {
      // Guest selects the slot.
      const guest = await guestContext();
      let intentId: string;
      try {
        const intentRes = await createSpaceBookingIntent(guest, {
          spaceId: space.id,
          unit: 'HOUR',
          startsAt,
          endsAt,
          paymentMode: 'ONLINE_FULL',
        });
        expect(intentRes.status()).toBe(201);
        intentId = (await intentRes.json()).id as string;
      } finally {
        await guest.dispose();
      }

      // The incubator fills the very same window with a manual booking.
      const taken = await manualBooking(inc, {
        itemKind: 'SPACE',
        itemId: space.id,
        unit: 'HOUR',
        startsAt,
        endsAt,
      });
      expect(taken.status(), `manual booking → ${taken.status()} ${await taken.text()}`).toBe(201);

      // Resume now re-checks LIVE availability → clean 409, nothing minted.
      const resume = await resumeBookingIntent(explorer, intentId);
      expect(resume.status(), `resume should be 409 → ${resume.status()} ${await resume.text()}`).toBe(409);
      expect((await resume.json()).error.code).toBe('SLOT_UNAVAILABLE');
    } finally {
      await explorer.dispose();
    }
  });
});
