/**
 * API-driven e2e: unified-seat-count CAPACITY GATES.
 *
 * These tests hit the JSON API directly (no UI) to assert the business-logic
 * gates around program applications, event registrations, and the unified
 * attendance counter (src/server/attendance.ts).
 *
 * Error envelope (verified in src/server/http/json.ts):
 *   { error: { code, message, details?: { ... } } }
 * — extra fields (capacity/taken/deadline/eventDate/existingBookingId) live
 * under `error.details`. We read defensively (error.details OR top-level OR
 * error.*) so the assertions survive any future un-nesting.
 *
 * Each test builds its OWN fixtures (unique programs/events) so assertions
 * never depend on global counts. All fixtures are FREE (price 0) → the wallet
 * is never involved.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createProgram,
  createEvent,
  applyToProgram,
  registerForEvent,
  submitRegistration,
  programStatus,
  eventStatus,
} from './_helpers';

/** Shape of a JSON error body — code/details may be nested or flat. */
interface MaybeErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  code?: string;
  [k: string]: unknown;
}

/** Pull the error code regardless of nesting. */
function errCode(body: MaybeErrorBody): string | undefined {
  return body?.error?.code ?? body?.code;
}

/** Pull an extra error field (e.g. capacity/taken) regardless of nesting. */
function errField(body: MaybeErrorBody, key: string): unknown {
  return body?.error?.details?.[key] ?? body?.error?.[key as keyof typeof body.error] ?? body?.[key];
}

/** Read an error response body once, returning it for assertions/messages. */
async function readError(res: APIResponse): Promise<MaybeErrorBody> {
  return (await res.json()) as MaybeErrorBody;
}

/** Success body for POST /api/registrations. */
interface RegistrationResponse {
  registration: { id: string; status: string; [k: string]: unknown };
  alreadyRegistered: boolean;
}

/** Generate a distinct email so the per-entity dedup guard never trips. */
function freshEmail(): string {
  return `qa-${Date.now()}-${Math.random().toString(36).slice(2)}@metwork.test`;
}

test.describe('Capacity gates', () => {
  let inc: APIRequestContext;
  let builder: APIRequestContext;
  let founder: APIRequestContext;
  let guest: APIRequestContext;

  test.beforeAll(async () => {
    inc = await roleContext('incubator');
    builder = await roleContext('builder');
    founder = await roleContext('founder');
    guest = await guestContext();
  });

  test.afterAll(async () => {
    await inc.dispose();
    await builder.dispose();
    await founder.dispose();
    await guest.dispose();
  });

  // 1. PROGRAM apply capacity gate
  test('program apply is blocked with CAPACITY_EXCEEDED once seats are full', async () => {
    const program = await createProgram(inc, { seatsTotal: 1 });

    const first = await applyToProgram(builder, program.id);
    expect(first.status(), `builder apply should be 201 → ${await first.text()}`).toBe(201);

    const afterFirst = await programStatus(builder, program.id);
    expect(afterFirst.taken, 'taken should be 1 after first apply').toBe(1);

    const second = await applyToProgram(founder, program.id);
    const body = await readError(second);
    expect(second.status(), `founder apply should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected CAPACITY_EXCEEDED → ${JSON.stringify(body)}`).toBe('CAPACITY_EXCEEDED');
    expect(errField(body, 'capacity'), `capacity in body → ${JSON.stringify(body)}`).toBe(1);
    expect(errField(body, 'taken'), `taken in body → ${JSON.stringify(body)}`).toBe(1);
  });

  // 2. EVENT register capacity gate
  test('event register is blocked with CAPACITY_EXCEEDED once seats are full', async () => {
    const event = await createEvent(inc, { capacity: 1 });

    const first = await registerForEvent(builder, event.id);
    expect(first.status(), `builder register should be 201 → ${await first.text()}`).toBe(201);

    const afterFirst = await eventStatus(builder, event.id);
    expect(afterFirst.taken, 'taken should be 1 after first register').toBe(1);

    const second = await registerForEvent(founder, event.id);
    const body = await readError(second);
    expect(second.status(), `founder register should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected CAPACITY_EXCEEDED → ${JSON.stringify(body)}`).toBe('CAPACITY_EXCEEDED');
    expect(errField(body, 'capacity'), `capacity in body → ${JSON.stringify(body)}`).toBe(1);
    expect(errField(body, 'taken'), `taken in body → ${JSON.stringify(body)}`).toBe(1);
  });

  // 3. ALREADY_APPLIED
  test('applying twice to the same program returns ALREADY_APPLIED', async () => {
    const program = await createProgram(inc, { seatsTotal: 5 });

    const first = await applyToProgram(builder, program.id);
    expect(first.status(), `first apply should be 201 → ${await first.text()}`).toBe(201);

    const second = await applyToProgram(builder, program.id);
    const body = await readError(second);
    expect(second.status(), `second apply should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected ALREADY_APPLIED → ${JSON.stringify(body)}`).toBe('ALREADY_APPLIED');
  });

  // 4. ALREADY_REGISTERED
  test('registering twice for the same event returns ALREADY_REGISTERED', async () => {
    const event = await createEvent(inc, { capacity: 5 });

    const first = await registerForEvent(founder, event.id);
    expect(first.status(), `first register should be 201 → ${await first.text()}`).toBe(201);

    const second = await registerForEvent(founder, event.id);
    const body = await readError(second);
    expect(second.status(), `second register should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected ALREADY_REGISTERED → ${JSON.stringify(body)}`).toBe('ALREADY_REGISTERED');
  });

  // 5. DEADLINE_PASSED
  test('applying to a program past its deadline returns DEADLINE_PASSED', async () => {
    const program = await createProgram(inc, { deadlineDays: -1, seatsTotal: 5 });

    const res = await applyToProgram(builder, program.id);
    const body = await readError(res);
    expect(res.status(), `apply should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected DEADLINE_PASSED → ${JSON.stringify(body)}`).toBe('DEADLINE_PASSED');
  });

  // 6. EVENT_PASSED
  test('registering for a past event returns EVENT_PASSED', async () => {
    const event = await createEvent(inc, { eventDays: -1, capacity: 5 });

    const res = await registerForEvent(builder, event.id);
    const body = await readError(res);
    expect(res.status(), `register should be 409 → ${JSON.stringify(body)}`).toBe(409);
    expect(errCode(body), `expected EVENT_PASSED → ${JSON.stringify(body)}`).toBe('EVENT_PASSED');
  });

  // 7. Unified count dedup (booking + same-user registration)
  test('unified count dedupes a booking and the same user\'s registration to one seat', async () => {
    const program = await createProgram(inc, { seatsTotal: 3 });

    // Founder applies → 1 seat taken.
    const apply = await applyToProgram(founder, program.id);
    expect(apply.status(), `founder apply should be 201 → ${await apply.text()}`).toBe(201);

    const afterApply = await programStatus(founder, program.id);
    expect(afterApply.taken, 'taken should be 1 after founder apply').toBe(1);

    // Same founder submits an AUTHENTICATED registration → same identity (u:qa-founder-id).
    const sameUserReg = await submitRegistration(
      founder,
      'PROGRAM',
      program.id,
      'test.founder@metwork.test',
      'QA Founder',
    );
    const sameUserBody = (await sameUserReg.json()) as RegistrationResponse;
    expect(sameUserReg.status(), `same-user registration should be 201 → ${JSON.stringify(sameUserBody)}`).toBe(201);
    expect(sameUserBody.registration.status, 'same-user registration should be CONFIRMED').toBe('CONFIRMED');

    // Re-read: still 1 — the same person deduped across booking + registration.
    const afterSameUser = await programStatus(founder, program.id);
    expect(afterSameUser.taken, 'taken must STILL be 1 (same identity deduped)').toBe(1);

    // A guest registration with a fresh distinct email is a NEW seat.
    const guestReg = await submitRegistration(guest, 'PROGRAM', program.id, freshEmail());
    const guestBody = (await guestReg.json()) as RegistrationResponse;
    expect(guestReg.status(), `guest registration should be 201 → ${JSON.stringify(guestBody)}`).toBe(201);
    expect(guestBody.registration.status, 'guest registration should be CONFIRMED (capacity left)').toBe('CONFIRMED');

    const afterGuest = await programStatus(founder, program.id);
    expect(afterGuest.taken, 'taken must now be 2 (distinct guest seat)').toBe(2);
  });

  // 8. Waitlist trigger
  test('a registration over a full event is WAITLISTED and holds no seat', async () => {
    const event = await createEvent(inc, { capacity: 1 });

    const reg = await registerForEvent(founder, event.id);
    expect(reg.status(), `founder register should be 201 → ${await reg.text()}`).toBe(201);

    const afterReg = await eventStatus(founder, event.id);
    expect(afterReg.taken, 'taken should be 1 after founder registers').toBe(1);

    // Guest registration over capacity → WAITLISTED.
    const waitlisted = await submitRegistration(guest, 'EVENT', event.id, freshEmail());
    const wBody = (await waitlisted.json()) as RegistrationResponse;
    expect(waitlisted.status(), `over-capacity registration should be 201 → ${JSON.stringify(wBody)}`).toBe(201);
    expect(wBody.registration.status, 'over-capacity registration should be WAITLISTED').toBe('WAITLISTED');

    const afterWaitlist = await eventStatus(founder, event.id);
    expect(afterWaitlist.taken, 'taken must remain 1 (WAITLISTED holds no seat)').toBe(1);
  });

  // 9. Status reconciliation
  test('program status reports capacity, taken, and deadlinePassed correctly', async () => {
    const open = await createProgram(inc, { seatsTotal: 7, deadlineDays: 10 });
    const openStatus = await programStatus(guest, open.id);
    expect(openStatus.capacity, 'open program capacity should be 7').toBe(7);
    expect(openStatus.taken, 'open program taken should be 0').toBe(0);
    expect(openStatus.deadlinePassed, 'open program deadline should not be passed').toBe(false);

    const closed = await createProgram(inc, { seatsTotal: 4, deadlineDays: -2 });
    const closedStatus = await programStatus(guest, closed.id);
    expect(closedStatus.capacity, 'closed program capacity should be 4').toBe(4);
    expect(closedStatus.deadlinePassed, 'closed program deadline should be passed').toBe(true);
  });
});
