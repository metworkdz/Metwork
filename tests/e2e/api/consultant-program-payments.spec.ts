/**
 * API-driven e2e: PAID consultant-owned programs (Workstream C).
 *
 * Consultant programs share the SAME ProgramRecord + card-payment settlement
 * path incubator programs use (`@/server/bookings/card-payment.ts`); the only
 * difference is which ledger gets credited — the consultant's own mentorId-keyed
 * one (`@/server/mentors/ledger.ts`) instead of an incubator WalletRecord.
 *
 *   1. ONLINE_FULL  — consultant creates a paid program, a guest pays the full
 *      total by card, the public program page shows the right price, and the
 *      consultant's mentor-ledger AVAILABLE balance is credited net of the 5%
 *      MENTOR_PROGRAM commission (immediate — no PENDING hold, mirroring how
 *      incubator programs pay out).
 *   2. CASH_DEPOSIT — consultant creates a program accepting CASH with a
 *      configured deposit; the intent settles to AWAITING_CASH, the consultant
 *      marks the on-site balance collected via the new
 *      /api/consultant/program-bookings/:id/mark-cash-paid route, and the
 *      booking reaches PAID — the SAME PENDING_PAYMENT → CONFIRMED status
 *      machine incubator CASH_DEPOSIT bookings already use, not a new one.
 *   3. FREE — a price-0 consultant program still enrols through the no-payment
 *      registration flow (regression check on the pre-existing free path).
 *   4. INCUBATOR REGRESSION — an incubator program still settles through
 *      card-payment.ts exactly as before (this suite touched shared code in
 *      resolveTarget/applyCardSettlement).
 *
 * Mock provider in SYNC mode. Serial (workers:1, shared seeded mentor).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  createProgram as createIncubatorProgram,
  cardIntent,
  settleCard,
  submitRegistration,
  findBookingByRef,
  clientRef,
  isoFromNow,
  guestContext,
} from './_helpers';
import { mintConsultantContext, consultantWallet } from './_consult-helpers';

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function cardCustomer(tag: string) {
  return { fullName: `QA ${tag}`, email: `qa.${tag}.${Date.now()}@metwork.test`, phone: '+213700998877' };
}

interface ConsultantProgramOpts {
  price?: number;
  acceptedPaymentMethods?: ('ONLINE' | 'CASH')[];
  cashDepositType?: 'PERCENT' | 'FIXED';
  cashDepositValue?: number;
  seatsTotal?: number;
}

/** Create a program fixture as the consultant. Returns the full ProgramRecord. */
async function createConsultantProgram(consultant: APIRequestContext, opts: ConsultantProgramOpts = {}) {
  const res = await consultant.post('/api/consultant/programs', {
    data: {
      title: `QA Consultant Program ${uniq()}`,
      description: 'Automated e2e paid-program fixture. Safe to delete.',
      type: 'WORKSHOP',
      city: 'Alger',
      price: opts.price ?? 0,
      acceptedPaymentMethods: opts.acceptedPaymentMethods ?? ['ONLINE'],
      ...(opts.cashDepositType ? { cashDepositType: opts.cashDepositType, cashDepositValue: opts.cashDepositValue } : {}),
      seatsTotal: opts.seatsTotal ?? 10,
      deadline: isoFromNow(30),
      startDate: isoFromNow(40),
      endDate: isoFromNow(70),
    },
  });
  expect(res.status(), `createConsultantProgram → ${res.status()} ${await res.text()}`).toBe(201);
  return res.json() as Promise<{ id: string; slug: string; price: number; mentorId: string; [k: string]: unknown }>;
}

/** Strip everything but digits, so locale-specific thousands separators never break the match. */
function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

test.describe.serial('Consultant-owned paid programs', () => {
  let consultant: APIRequestContext;
  let incubator: APIRequestContext;
  let guest: APIRequestContext;

  test.beforeAll(async () => {
    ({ ctx: consultant } = await mintConsultantContext());
    incubator = await roleContext('incubator');
    guest = await guestContext();
  });
  test.afterAll(async () => {
    await incubator.dispose();
    await guest.dispose();
  });

  test('ONLINE_FULL: paid program settles, credits the mentor ledger net of the 5% program commission, price shown on the public page', async ({ page }) => {
    const price = 6000;
    const program = await createConsultantProgram(consultant, { price, acceptedPaymentMethods: ['ONLINE'] });

    const before = await consultantWallet(consultant);

    const ref = clientRef('cp-online');
    const intent = await cardIntent(guest, {
      target: { itemKind: 'PROGRAM', programId: program.id },
      paymentMode: 'ONLINE_FULL',
      customer: cardCustomer('cp-online'),
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    // Intent starts life as a PENDING_PAYMENT hold — no seat, no money moved yet.
    const pending = findBookingByRef(ref);
    expect(pending?.status, 'card intent starts PENDING_PAYMENT').toBe('PENDING_PAYMENT');

    await settleCard(guest, token);

    const b = findBookingByRef(ref)!;
    expect(b.status, 'settled → CONFIRMED').toBe('CONFIRMED');
    expect(b.paymentStatus, 'full online → PAID').toBe('PAID');
    expect(b.totalAmount, 'total matches the program price').toBe(price);
    expect(b.onlinePaidAmount, 'whole total paid online').toBe(price);

    // Mentor ledger credited immediately (no PENDING hold) net of the 5%
    // MENTOR_PROGRAM commission — the same resolver consultations use, just
    // its first real caller for a program.
    const after = await consultantWallet(consultant);
    const expectedNet = price - Math.round(price * 0.05);
    expect(after.available - before.available, 'mentor AVAILABLE balance credited net of commission').toBe(expectedNet);
    expect(after.pending, 'no PENDING hold for program earnings').toBe(before.pending);

    // The public program page renders with the right price (locale-agnostic digit match).
    const resp = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'networkidle' });
    expect(resp?.status(), 'program page HTTP status').toBeLessThan(400);
    const bodyText = await page.textContent('body');
    expect(digitsOnly(bodyText ?? ''), 'price digits appear on the page').toContain(String(price));
  });

  test('CASH_DEPOSIT: deposit paid online, balance collected on-site, reuses PENDING_PAYMENT → CONFIRMED/AWAITING_CASH → PAID (no new status)', async () => {
    const price = 4000;
    const program = await createConsultantProgram(consultant, {
      price,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 20,
    });

    const before = await consultantWallet(consultant);

    const ref = clientRef('cp-cash');
    const intent = await cardIntent(guest, {
      target: { itemKind: 'PROGRAM', programId: program.id },
      paymentMode: 'CASH_DEPOSIT',
      customer: cardCustomer('cp-cash'),
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    // Same intent status the incubator CASH_DEPOSIT flow produces — no parallel status.
    expect(findBookingByRef(ref)?.status, 'card intent starts PENDING_PAYMENT').toBe('PENDING_PAYMENT');

    await settleCard(guest, token);

    const settled = findBookingByRef(ref)!;
    expect(settled.status, 'deposit settled → CONFIRMED').toBe('CONFIRMED');
    expect(settled.paymentStatus, 'balance still due → AWAITING_CASH').toBe('AWAITING_CASH');
    const expectedDeposit = Math.round(price * 0.2);
    expect(settled.onlinePaidAmount, 'online deposit = 20% of total').toBe(expectedDeposit);
    expect(settled.cashRemainingAmount, 'remainder due in cash').toBe(price - expectedDeposit);

    // Mentor credited on the DEPOSIT only (never the cash remainder) — same
    // rule the incubator receiver-commission engine already follows.
    const afterDeposit = await consultantWallet(consultant);
    const expectedNet = expectedDeposit - Math.round(expectedDeposit * 0.05);
    expect(afterDeposit.available - before.available, 'mentor credited on the online deposit only').toBe(expectedNet);

    // Consultant collects the balance on-site → marks it paid via the new
    // consultant-scoped route (reuses the same core as the incubator route).
    const marked = await consultant.patch(`/api/consultant/program-bookings/${settled.id}/mark-cash-paid`);
    expect(marked.status(), `mark-cash-paid → ${marked.status()} ${await marked.text()}`).toBe(200);

    const finalBooking = findBookingByRef(ref)!;
    expect(finalBooking.paymentStatus, 'cash collected → PAID').toBe('PAID');
    expect(finalBooking.status, 'status unchanged by cash collection').toBe('CONFIRMED');

    // Marking cash paid moves NO ledger money (already credited on the deposit).
    const afterCash = await consultantWallet(consultant);
    expect(afterCash.available, 'no further ledger movement on cash collection').toBe(afterDeposit.available);

    // Idempotent — a repeat call is a no-op, not an error.
    const replay = await consultant.patch(`/api/consultant/program-bookings/${settled.id}/mark-cash-paid`);
    expect(replay.status(), 'replay mark-cash-paid is idempotent').toBe(200);
  });

  test('FREE: a price-0 consultant program still enrols through the no-payment registration flow', async () => {
    const program = await createConsultantProgram(consultant, { price: 0 });
    const email = `qa.cp.free.${Date.now()}@metwork.test`;

    const res = await submitRegistration(guest, 'PROGRAM', program.id, email);
    expect(res.status(), `free registration → ${res.status()} ${await res.text()}`).toBe(201);
  });

  test('INCUBATOR REGRESSION: an incubator-owned program still settles through card-payment.ts unchanged', async () => {
    const price = 3000;
    const incProgram = await createIncubatorProgram(incubator, { price });

    const ref = clientRef('inc-regress');
    const intent = await cardIntent(guest, {
      target: { itemKind: 'PROGRAM', programId: incProgram.id },
      paymentMode: 'ONLINE_FULL',
      customer: cardCustomer('inc-regress'),
      clientReference: ref,
    });
    expect(intent.status(), `intent → ${intent.status()} ${await intent.text()}`).toBe(201);
    const { token } = await intent.json();

    await settleCard(guest, token);

    const b = findBookingByRef(ref)!;
    expect(b.status, 'incubator program settles → CONFIRMED').toBe('CONFIRMED');
    expect(b.paymentStatus, 'full online → PAID').toBe('PAID');
    expect(b.onlinePaidAmount, 'whole total paid online').toBe(price);
  });
});
