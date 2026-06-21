/**
 * API-driven e2e — instant-book, pay-first CONSULTATIONS (P1–P7).
 *
 * Covers booking creation, settlement, the free/zero path, slot rejection, the
 * concurrency lock and settlement idempotency. Runs SERIALLY against the shared
 * seeded mentor; requires the dev server in MOCK SYNC payment mode.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  mintConsultantContext,
  setupMentorAvailability,
  nextUniqueSlot,
  instantBook,
  consultantWallet,
  ensureConsultationPromo,
  expectedConsultantShare,
  getMentorFee,
  clientRef,
} from './_consult-helpers';

async function errCode(res: APIResponse): Promise<string | undefined> {
  const body = await res.json().catch(() => ({}));
  return body?.error?.code ?? body?.code;
}
async function dump(res: APIResponse): Promise<string> {
  return `${res.status()} ${await res.text()}`;
}

test.describe.serial('Consultation instant-book — booking & settlement', () => {
  let admin: APIRequestContext;
  let consultant: APIRequestContext;
  let founder: APIRequestContext;
  let builder: APIRequestContext;
  let fee: number;
  const slots = nextUniqueSlot;

  test.beforeAll(async () => {
    admin = await roleContext('admin');
    founder = await roleContext('founder');
    builder = await roleContext('builder');
    ({ ctx: consultant } = await mintConsultantContext(admin));
    await setupMentorAvailability(consultant, { minNoticeHours: 1, bufferMinutes: 0 });
    fee = await getMentorFee(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
    await consultant.dispose();
    await founder.dispose();
    await builder.dispose();
  });

  test('1 — member books a paid slot → CONFIRMED instantly (mock SlickPay top-up, no admin step)', async () => {
    const { date, time } = slots();
    const res = await instantBook(founder, { date, time, durationMinutes: 60 });
    expect(res.status(), `expected 201, got ${await dump(res)}`).toBe(201);
    const body = await res.json();
    expect(body.mode, `expected confirmed, got ${JSON.stringify(body)}`).toBe('confirmed');
    // Seeded mentor has no default meeting format → settles to AWAITING_LINK
    // (still PAID/settled — the legacy PENDING/admin-approval state is gone).
    expect(['AWAITING_LINK', 'READY', 'CONFIRMED']).toContain(body.status);

    // The legacy admin approve/decline gate is retired (410), proving no admin step.
    const gate = await admin.patch(`/api/admin/mentor-bookings/${body.id}`, { data: { status: 'APPROVED' } });
    expect(gate.status(), `approval gate should be 410, got ${await dump(gate)}`).toBe(410);
  });

  test('2 — free-intro (100% promo) slot → CONFIRMED with no payment step (member)', async () => {
    // Consultations are account-only — a member drives the zero-price path.
    const promo = await ensureConsultationPromo(admin, 100);
    const { date, time } = slots();
    const res = await instantBook(founder, { date, time, durationMinutes: 60, promoCode: promo });
    expect(res.status(), `expected 201, got ${await dump(res)}`).toBe(201);
    const body = await res.json();
    expect(body.mode, `expected confirmed (zero-price), got ${JSON.stringify(body)}`).toBe('confirmed');
    expect(body.payToken, 'a zero-price booking must not issue a pay token').toBeFalsy();
  });

  test('3a — a slot outside the availability template is rejected (409 SLOT_NOT_BOOKABLE)', async () => {
    // 12:00 is a gap between the 11:00 and 13:00 template slots.
    const res = await instantBook(founder, { date: slots().date, time: '12:00', durationMinutes: 60 });
    expect(res.status(), `expected 409, got ${await dump(res)}`).toBe(409);
    expect(await errCode(res)).toBe('SLOT_NOT_BOOKABLE');
  });

  test('3b — a slot inside the 24h advance window is rejected (422 TOO_SOON)', async () => {
    // Today @ 09:00 is always < 24h away.
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
    const res = await instantBook(founder, { date, time: '09:00', durationMinutes: 60 });
    expect(res.status(), `expected 422, got ${await dump(res)}`).toBe(422);
    expect(await errCode(res)).toBe('TOO_SOON');
  });

  test('4 — two members race the same slot → exactly one succeeds (lock holds)', async () => {
    const { date, time } = slots();
    const [a, b] = await Promise.all([
      instantBook(founder, { date, time, durationMinutes: 60, clientReference: clientRef('race-a') }),
      instantBook(builder, { date, time, durationMinutes: 60, clientReference: clientRef('race-b') }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses, `expected one 201 and one 409, got ${a.status()} & ${b.status()}`).toEqual([201, 409]);
    const loser = a.status() === 409 ? a : b;
    expect(await errCode(loser)).toBe('SLOT_NOT_BOOKABLE');
  });

  test('5 — a replayed member booking credits the consultant exactly once (idempotent)', async () => {
    // Account-only flow: a member books and pays (mock-sync top-up settles in
    // the request). Replaying the same idempotency key must return the original
    // booking and NOT credit the consultant twice.
    const { date, time } = slots();
    const ref = clientRef('member-replay');
    const before = await consultantWallet(consultant);

    const first = await instantBook(founder, { date, time, durationMinutes: 60, clientReference: ref });
    expect(first.status(), `first booking → ${await dump(first)}`).toBe(201);
    const b1 = await first.json();
    expect(b1.mode, `expected confirmed, got ${JSON.stringify(b1)}`).toBe('confirmed');

    const replay = await instantBook(founder, { date, time, durationMinutes: 60, clientReference: ref });
    expect(replay.status(), `replay → ${await dump(replay)}`).toBe(201);
    const b2 = await replay.json();
    expect(b2.id, 'replay returns the original booking').toBe(b1.id);

    const after = await consultantWallet(consultant);
    expect(
      after.pending - before.pending,
      `consultant should be credited exactly once (${expectedConsultantShare(60, fee)} DZD)`,
    ).toBe(expectedConsultantShare(60, fee));
  });
});
