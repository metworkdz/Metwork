/**
 * API-driven e2e — CONSULTANT self-service portal (P5/P6) over the instant-book
 * lifecycle: durable-token + PIN access, PII gating, meeting-link / in-person
 * resolution, consultant-initiated cancel (wallet refund + credit reversal),
 * completion → withdrawal → admin payout, and bidirectional reschedule.
 *
 * Serial against the shared seeded mentor; dev server in MOCK SYNC payment mode.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  MENTOR_ID,
  roleContext,
  guestContext,
  mintConsultantContext,
  setupMentorAvailability,
  setMinNotice,
  nextUniqueSlot,
  instantBook,
  consultantWallet,
  consultantBooking,
  userWalletBalance,
  expectedConsultantShare,
  getMentorFee,
  xff,
} from './_consult-helpers';

async function errCode(res: APIResponse): Promise<string | undefined> {
  const body = await res.json().catch(() => ({}));
  return body?.error?.code ?? body?.code;
}
async function dump(res: APIResponse): Promise<string> {
  return `${res.status()} ${await res.text()}`;
}

/** Book a settled member slot (60 min) and return its id. */
async function bookMember(
  member: APIRequestContext,
  slot: { date: string; time: string },
): Promise<{ id: string }> {
  const res = await instantBook(member, { ...slot, durationMinutes: 60 });
  expect(res.status(), `member book → ${await dump(res)}`).toBe(201);
  const body = await res.json();
  expect(body.mode).toBe('confirmed');
  return { id: body.id };
}

test.describe.serial('Consultation portal — access, lifecycle, payouts, reschedule', () => {
  let admin: APIRequestContext;
  let consultant: APIRequestContext;
  let founder: APIRequestContext;
  let fee: number;
  const slots = nextUniqueSlot;

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    founder = await roleContext('founder');
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
    fee = await getMentorFee(admin);
  });

  test.afterAll(async () => {
    // Leave the mentor in a sane notice window for re-runs / other files.
    await setMinNotice(consultant, 1).catch(() => {});
    await admin.dispose();
    await consultant.dispose();
    await founder.dispose();
  });

  test('6a — client PII is not exposed without a consultant session (401)', async () => {
    const guest = await guestContext();
    try {
      const res = await guest.get('/api/consultant/bookings');
      expect(res.status(), `expected 401, got ${await dump(res)}`).toBe(401);
    } finally {
      await guest.dispose();
    }
  });

  test('6b — wrong PIN is rejected (401 WRONG_PIN)', async () => {
    // Mint a fresh token (rotation does NOT kill existing sessions). PIN was set
    // in beforeAll, so a wrong PIN now verifies → 401.
    const tok = await admin.post(`/api/admin/mentors/${MENTOR_ID}/access-token`);
    const { token } = await tok.json();
    const ctx = await guestContext();
    try {
      const res = await ctx.post('/api/consultant/pin', {
        headers: xff(),
        data: { token, pin: '9999' },
      });
      expect(res.status(), `expected 401, got ${await dump(res)}`).toBe(401);
      expect(await errCode(res)).toBe('WRONG_PIN');
    } finally {
      await ctx.dispose();
    }
    // Re-establish a valid session for the rest of the suite (token was rotated).
    ({ ctx: consultant } = await mintConsultantContext(admin));
  });

  test('6c — PIN attempts are rate-limited per IP (429)', async () => {
    // Hammer with a BOGUS token from ONE IP: mentorId stays null so only the
    // per-IP bucket (20/15min) is consumed — the real mentor PIN budget is safe.
    const ip = '10.231.231.231';
    const ctx = await guestContext();
    let sawRateLimit = false;
    try {
      for (let i = 0; i < 24; i++) {
        const res = await ctx.post('/api/consultant/pin', {
          headers: xff(ip),
          data: { token: 'definitely-not-a-real-token', pin: '1234' },
        });
        if (res.status() === 429) {
          sawRateLimit = true;
          break;
        }
        expect(res.status(), `pre-limit responses should be 401, got ${await dump(res)}`).toBe(401);
      }
    } finally {
      await ctx.dispose();
    }
    expect(sawRateLimit, 'expected a 429 after exhausting the per-IP PIN budget').toBe(true);
  });

  test('7 — consultant adds an ONLINE meeting link → booking becomes READY', async () => {
    const { id } = await bookMember(founder, slots());
    const link = 'https://meet.example.com/qa-online';
    const res = await consultant.post(`/api/consultant/bookings/${id}/link`, {
      data: { mode: 'ONLINE', link },
    });
    expect(res.status(), `set link → ${await dump(res)}`).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('READY');
    expect(body.meetingMode).toBe('ONLINE');
    expect(body.meetingLink).toBe(link);

    // Re-issuing details is idempotent (stays READY, no error) — dedup of the
    // client notice is enforced internally by linkSentAt.
    const again = await consultant.post(`/api/consultant/bookings/${id}/link`, {
      data: { mode: 'ONLINE', link },
    });
    expect(again.status(), `re-issue link → ${await dump(again)}`).toBe(200);
  });

  test('8 — offline booking: consultant sets an in-person address (no link required)', async () => {
    const { id } = await bookMember(founder, slots());
    const address = '12 Rue Didouche Mourad, Alger';
    const res = await consultant.post(`/api/consultant/bookings/${id}/link`, {
      data: { mode: 'OFFLINE', address, mapsLink: 'https://maps.google.com/?q=36.77,3.06' },
    });
    expect(res.status(), `set offline → ${await dump(res)}`).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('READY');
    expect(body.meetingMode).toBe('OFFLINE');
    expect(body.meetingAddress).toBe(address);
    expect(body.meetingLink).toBeFalsy();
  });

  test('9 — consultant cancels → user wallet refunded, consultant credit reversed', async () => {
    const pendPre = (await consultantWallet(consultant)).pending;
    const { id } = await bookMember(founder, slots());

    const booking = await consultantBooking(consultant, id);
    const charged = Number(booking?.amountCharged ?? 0);
    expect(charged, 'expected a positive charge on a paid booking').toBeGreaterThan(0);

    // Net wallet movement of a sync top-up booking is zero (top-up in, charge out).
    const walletAfterBook = await userWalletBalance(founder);
    const pendAfterBook = (await consultantWallet(consultant)).pending;
    // Consultant is credited on the FULL base (subsidize), independent of tier.
    expect(pendAfterBook - pendPre, 'consultant credited on booking').toBe(expectedConsultantShare(60, fee));

    const cancel = await consultant.post(`/api/consultant/bookings/${id}/cancel`, {
      data: { reason: 'QA automated cancellation' },
    });
    expect(cancel.status(), `cancel → ${await dump(cancel)}`).toBe(200);
    const cbody = await cancel.json();
    expect(cbody.status).toBe('CANCELLED');
    expect(cbody.refundedAmount, 'full amount refunded to the user wallet').toBe(charged);

    // Wallet rose by exactly the charge; consultant credit returned to baseline.
    const walletAfterCancel = await userWalletBalance(founder);
    expect(walletAfterCancel - walletAfterBook).toBe(charged);
    expect((await consultantWallet(consultant)).pending).toBe(pendPre);
  });

  test('10 — complete → consultant requests withdrawal → admin approves → wallet debited', async () => {
    const availPre = (await consultantWallet(consultant)).available;
    const { id } = await bookMember(founder, slots());
    const share = expectedConsultantShare(60, fee); // round(base × 0.7)

    const complete = await consultant.post(`/api/consultant/bookings/${id}/complete`);
    expect(complete.status(), `complete → ${await dump(complete)}`).toBe(200);
    const availAfterComplete = (await consultantWallet(consultant)).available;
    expect(availAfterComplete - availPre, 'released earning to AVAILABLE').toBe(share);

    const reqRes = await consultant.post('/api/consultant/withdrawals', {
      data: { amount: 500, accountDetails: 'CCP 0000000000 key 00 — QA' },
    });
    expect(reqRes.status(), `withdrawal request → ${await dump(reqRes)}`).toBe(201);
    const { withdrawal } = await reqRes.json();
    expect(withdrawal.status).toBe('PENDING');
    // Escrow held immediately: AVAILABLE drops at request time.
    expect((await consultantWallet(consultant)).available).toBe(availAfterComplete - 500);

    const approve = await admin.patch(`/api/admin/mentor-withdrawals/${withdrawal.id}`, {
      data: { status: 'APPROVED', adminNote: 'QA payout' },
    });
    expect(approve.status(), `admin approve → ${await dump(approve)}`).toBe(200);
    expect((await approve.json()).withdrawal.status).toBe('APPROVED');
    // Money already left AVAILABLE at request time; approval just completes the hold.
    expect((await consultantWallet(consultant)).available).toBe(availAfterComplete - 500);
  });

  test('11 — reschedule from BOTH sides, then blocked at the cap', async () => {
    const { id } = await bookMember(founder, slots());

    // Consultant moves it (notifies the user).
    const s1 = slots();
    const r1 = await consultant.post(`/api/consultant/bookings/${id}/reschedule`, { data: { date: s1.date, time: s1.time } });
    expect(r1.status(), `consultant reschedule → ${await dump(r1)}`).toBe(200);
    expect((await r1.json()).rescheduleCount).toBe(1);

    // User moves it (notifies the consultant).
    const s2 = slots();
    const r2 = await founder.post(`/api/consultations/${id}/reschedule`, { data: { date: s2.date, time: s2.time } });
    expect(r2.status(), `user reschedule → ${await dump(r2)}`).toBe(200);
    expect((await r2.json()).rescheduleCount).toBe(2);

    // Third move exceeds MAX_RESCHEDULES (2) → blocked.
    const s3 = slots();
    const r3 = await consultant.post(`/api/consultant/bookings/${id}/reschedule`, { data: { date: s3.date, time: s3.time } });
    expect(r3.status(), `over-cap reschedule → ${await dump(r3)}`).toBe(409);
    expect(await errCode(r3)).toBe('RESCHEDULE_LIMIT');
  });

  test('11b — reschedule is blocked inside the notice window (422 TOO_LATE)', async () => {
    const { id } = await bookMember(founder, slots());
    // Widen the notice window so the (future) session is now "inside" it.
    await setMinNotice(consultant, 720);
    try {
      const s = slots();
      const res = await consultant.post(`/api/consultant/bookings/${id}/reschedule`, { data: { date: s.date, time: s.time } });
      expect(res.status(), `expected 422 TOO_LATE, got ${await dump(res)}`).toBe(422);
      expect(await errCode(res)).toBe('TOO_LATE');
    } finally {
      await setMinNotice(consultant, 1);
    }
  });
});
